#!/usr/bin/env node

'use strict';

var srcPath = process.argv[3] || require.resolve('acorn');
var destPath = process.argv[2];

if (!destPath) {
	console.log('Usage: acorn-csp <path to acorn> <destination filename>');
	process.exit(1);
}

var fs = require('fs');
var vm = require('vm');
var esprima = require('esprima');
var recast = require('recast');
var b = recast.types.builders;

// Read original Acorn's source with conservative parser (recast).
var source = fs.readFileSync(srcPath, 'utf-8');
var ast = recast.parse(source, {esprima: esprima});

// Instrument code with predicate collector.
var makePredicatePath, makePredicateCache = {};

recast.visit(ast, {
	visitFunctionDeclaration: function (path) {
		var node = path.node;
		if (node.id.name === 'makePredicate') {
			// Found makePredicate function.
			makePredicatePath = path;
			// And provide wrapper that collects all the possible results.
			path.insertAfter(b.expressionStatement(
				b.assignmentExpression(
					'=',
					node.id,
					b.callExpression(
						b.identifier('wrapMakePredicate'),
						[node.id]
					)
				)
			));
			return false;
		} else {
			this.traverse(path);
		}
	}
});

// Execute instrumented code and collect possible predicates.
var makePredicateCache = Object.create(null);

vm.runInNewContext(
	recast.prettyPrint(ast).code,
	{
		wrapMakePredicate: function (makePredicate) {
			return function (words) {
				var generatedFn = makePredicate(words);
				makePredicateCache[words] = generatedFn.toString();
				return generatedFn;
			};
		}
	}
);

// Remove wrapper.
makePredicatePath.parentPath.get(makePredicatePath.name + 1).replace();

// And generate it's body as hash of collected inputs/outputs.
makePredicatePath.get('body', 'body').replace([b.returnStatement(
	b.memberExpression(
		b.objectExpression(Object.keys(makePredicateCache).map(function (key) {
			var funcNode = esprima.parse(makePredicateCache[key]).body[0];
			return b.property('init', b.literal(key), b.functionExpression(
				null,
				funcNode.params,
				funcNode.body
			));
		})),
		makePredicatePath.get('params', 0).node,
		true
	)
)]);

// Finally, save transformed AST to file with preserved formatting.
fs.writeFileSync(destPath, recast.print(ast).code);

console.log('Generated successfully!');