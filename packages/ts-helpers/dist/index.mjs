import { sep, relative } from 'path';
import ts from 'typescript';

function regExpEscape(s) {
    return s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}
class Tokenizer {
    constructor(pathKey, subs, tokens = ['*']) {
        this.subs = subs;
        this.tokens = [];
        const tokenMask = new RegExp(`(${tokens.map(regExpEscape).join('|')})`, 'g');
        const mask = pathKey.replace(tokenMask, token => {
            this.tokens.push(new RegExp(regExpEscape(token), 'g'));
            return '><';
        });
        this.mask = new RegExp('^' + regExpEscape(mask).replace(/\>\</g, '(?!\\.\\/)(.*)') + '$');
    }
    parse(str) {
        const { mask, tokens, subs } = this;
        const match = str.match(mask);
        if (match) {
            const parsedSubs = [];
            for (let sub of subs) {
                for (let i = 1; i < match.length; i++) {
                    const token = tokens[i - 1];
                    const replacement = match[i];
                    sub = sub.replace(token, replacement);
                }
                parsedSubs.push(sub);
            }
            return parsedSubs;
        }
    }
}

const winSepRegex = new RegExp(regExpEscape(sep), 'g');
const posixSepRegex = /\//g;
class ImportPathsResolver {
    constructor(opts) {
        const paths = opts.paths || {};
        const baseUrl = this.baseUrl = opts.baseUrl ? opts.baseUrl.replace(winSepRegex, '\/') : '';
        const mapBaseUrl = baseUrl
            ? sub => (sub[0] === '/'
                ? sub
                : `${baseUrl}/${sub.substring(0, 2) === './' ? sub.substring(2) : sub}`)
            : undefined;
        this.tokenizers = Object.keys(paths)
            .filter(key => !opts.exclude || !opts.exclude.includes(key))
            .map(key => new Tokenizer(key, mapBaseUrl ? paths[key].map(mapBaseUrl) : paths[key]));
    }
    getImportSuggestions(oldImport, fileName) {
        if (isRelative(oldImport))
            return;
        for (let tokenizer of this.tokenizers) {
            const match = tokenizer.parse(oldImport);
            if (match) {
                return match.map(p => {
                    const newPath = relative(fileName, p.replace(posixSepRegex, sep)).replace(winSepRegex, '\/');
                    return isRelative(newPath) ? newPath : ('./' + newPath);
                });
            }
        }
        const defaultPath = relative(fileName, this.baseUrl + '/' + oldImport).replace(winSepRegex, '\/');
        return [isRelative(defaultPath) ? defaultPath : ('./' + defaultPath)];
    }
}
function isRelative(fileName) {
    return fileName === '.' || fileName.startsWith('./') || fileName.startsWith('../');
}

class Replacer {
    constructor(sourceText) {
        this.sourceText = sourceText;
        this.items = [];
    }
    push(item) {
        this.items.push(item);
    }
    getReplaced() {
        const { items, sourceText } = this;
        if (items.length === 0)
            return;
        let result = '';
        let pos = 0;
        for (let item of items) {
            result += sourceText.substring(pos, item.start) + item.replacement;
            pos = item.start + item.length;
        }
        result += sourceText.substring(pos);
        return result;
    }
}

function createTraverseVisitor(traverseVisitor, visitorContext, ctx) {
    return function visitor(node) {
        return traverseVisitor(node, visitorContext) || ts.visitEachChild(node, visitor, ctx);
    };
}

export { ImportPathsResolver, Replacer, Tokenizer, createTraverseVisitor, posixSepRegex, regExpEscape, winSepRegex };
//# sourceMappingURL=index.mjs.map
