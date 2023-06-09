'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var ts = _interopDefault(require('typescript'));
var tsHelpers = require('@zerollup/ts-helpers');
var path = _interopDefault(require('path'));

const defaultConfig = {};

const fileExistsParts = ['.min.js', '.js'];
const tsParts = ['.ts', '.d.ts', '.tsx', '/index.ts', '/index.tsx', '/index.d.ts', ''];
class ImportPathInternalResolver {
    constructor(program, transformationContext, config) {
        this.program = program;
        this.config = config;
        const { paths, baseUrl } = transformationContext.getCompilerOptions();
        this.resolver = new tsHelpers.ImportPathsResolver({
            paths,
            baseUrl,
            exclude: config.exclude,
        });
        this.emitHost = transformationContext.getEmitHost
            ? transformationContext.getEmitHost()
            : undefined;
    }
    fileExists(file) {
        const { program, emitHost } = this;
        if (program === null || program === void 0 ? void 0 : program.fileExists)
            return program.fileExists(file);
        if (emitHost === null || emitHost === void 0 ? void 0 : emitHost.fileExists)
            return emitHost.fileExists(file);
        return true;
    }
    resolveImport(oldImport, currentDir) {
        const config = this.config;
        const newImports = this.resolver.getImportSuggestions(oldImport, currentDir);
        if (!newImports)
            return;
        for (let newImport of newImports) {
            const newImportPath = path.join(currentDir, newImport);
            for (let part of tsParts) {
                if (this.fileExists(`${newImportPath}${part}`))
                    return newImport;
            }
            if (config.tryLoadJs) {
                for (let ext of fileExistsParts) {
                    if (this.fileExists(`${newImportPath}${ext}`))
                        return `${newImport}${ext}`;
                }
            }
        }
    }
}

function createFixNode(sf) {
    const posMap = new Map();
    return function fixNode(fixNode, newImport) {
        /**
         * This hack needed for properly d.ts paths rewrite.
         * moduleSpecifier value obtained by moduleSpecifier.pos from original source file text.
         * See emitExternalModuleSpecifier -> writeTextOfNode -> getTextOfNodeFromSourceText.
         *
         * We need to add new import path to the end of source file text and adjust moduleSpecifier.pos
         *
         * ts remove quoted string from output
         */
        const newStr = `"${newImport}"`;
        let cachedPos = posMap.get(newImport);
        if (cachedPos === undefined) {
            cachedPos = sf.text.length;
            posMap.set(newImport, cachedPos);
            sf.text += newStr;
            //@ts-ignore
            sf.end += newStr.length;
        }
        //@ts-ignore
        fixNode.pos = cachedPos;
        //@ts-ignore
        fixNode.end = cachedPos + newStr.length;
        return fixNode;
    };
}

function stripQuotes(quoted) {
    if (quoted[0] !== '"' && quoted[0] !== "'")
        return quoted;
    return quoted.substring(1, quoted.length - 1);
}
function importPathVisitor(node, { fixNode, sf, resolver }) {
    let importValue;
    let nodeToFix;
    // dynamic import or require()
    if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (node.arguments.length === 0)
            return;
        const arg = node.arguments[0];
        if (!ts.isStringLiteral(arg))
            return;
        if (
        // Can't call getText on after step
        expression.getText(sf) !== 'require' &&
            expression.kind !== ts.SyntaxKind.ImportKeyword)
            return;
        importValue = stripQuotes(arg.getText(sf));
        nodeToFix = arg;
        // import, export
    }
    else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
            return;
        // do not use getFullText() here, bug in watch mode, https://github.com/zerkalica/zerollup/issues/12
        importValue = node.moduleSpecifier.text;
        nodeToFix = node.moduleSpecifier;
    }
    else if (ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)) {
        importValue = node.argument.literal.text;
    }
    else if (ts.isModuleDeclaration(node)) {
        if (!ts.isStringLiteral(node.name))
            return;
        importValue = node.name.text;
        nodeToFix = node.name;
    }
    else {
        return;
    }
    const newImport = resolver.resolveImport(importValue, path.dirname(sf.fileName));
    if (!newImport || newImport === importValue)
        return;
    if (nodeToFix && fixNode)
        fixNode(nodeToFix, newImport);
    // const newSpec = ts.createLiteral(newImport)
    const newSpec = ts.factory.createStringLiteral(newImport);
    let newNode;
    if (ts.isImportTypeNode(node)) {
        newNode = ts.factory.updateImportTypeNode(node, ts.factory.createLiteralTypeNode(newSpec), node.assertions, node.qualifier, node.typeArguments, node.isTypeOf);
        //@ts-ignore
        newNode.flags = node.flags;
    }
    if (ts.isImportDeclaration(node)) {
        newNode = ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, newSpec, node.assertClause);
        /**
         * Without this hack ts generates bad import of pure interface in output js,
         * this causes warning "module has no exports" in bundlers.
         *
         * index.ts
         * ```ts
         * import {Some} from './lib'
         * export const some: Some = { self: 'test' }
         * ```
         *
         * lib.ts
         * ```ts
         * export interface Some { self: string }
         * ```
         *
         * output: index.js
         * ```js
         * import { Some } from "./some/lib"
         * export const some = { self: 'test' }
         * ```
         */
        //@ts-ignore
        newNode.flags = node.flags;
    }
    if (ts.isExportDeclaration(node)) {
        const exportNode = ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, newSpec, node.assertClause);
        if (exportNode.flags !== node.flags) {
            /**
             * Additional hacks for exports. Without it ts throw exception, if flags changed in export node.
             */
            const ms = exportNode.moduleSpecifier;
            const oms = node.moduleSpecifier;
            if (ms && oms) {
                //@ts-ignore
                ms.pos = oms.pos;
                //@ts-ignore
                ms.end = oms.end;
                //@ts-ignore
                ms.parent = oms.parent;
            }
            newNode = exportNode;
            //@ts-ignore
            newNode.flags = node.flags;
        }
    }
    if (ts.isCallExpression(node))
        newNode = ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [
            newSpec,
        ]);
    if (ts.isModuleDeclaration(node)) {
        newNode = ts.factory.updateModuleDeclaration(node, node.modifiers, newSpec, node.body);
    }
    return newNode;
}

function transformPaths(program, configRaw = defaultConfig) {
    const config = Object.assign(Object.assign({}, defaultConfig), configRaw);
    function createTransformer(transformationContext) {
        const resolver = new ImportPathInternalResolver(program, transformationContext, config);
        return function transformer(sf) {
            return ts.visitNode(sf, tsHelpers.createTraverseVisitor(importPathVisitor, {
                fixNode: config.disableForDeclarations
                    ? undefined
                    : createFixNode(sf),
                sf,
                resolver,
            }, transformationContext));
        };
    }
    const plugin = {
        before: createTransformer,
        afterDeclarations: config.disableForDeclarations
            ? undefined
            : createTransformer,
    };
    return plugin;
}

module.exports = transformPaths;
//# sourceMappingURL=index.js.map
