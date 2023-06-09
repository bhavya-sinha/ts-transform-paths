import ts from 'typescript';
export type TraverseVisitor<VisitorContext> = (node: ts.Node, visitorContext: VisitorContext) => ts.VisitResult<ts.Node> | undefined;
export declare function createTraverseVisitor<VisitorContext>(traverseVisitor: TraverseVisitor<VisitorContext>, visitorContext: VisitorContext, ctx: ts.TransformationContext): ts.Visitor;
