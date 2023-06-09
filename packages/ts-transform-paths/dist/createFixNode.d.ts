import ts from 'typescript';
export type FixNode = (fixNode: ts.Node, newImport: string) => ts.Node;
export declare function createFixNode(sf: ts.SourceFile): (fixNode: ts.Node, newImport: string) => ts.Node;
