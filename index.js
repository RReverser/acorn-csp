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
			// Rename it temporarily.
			node.id.name = '_makePredicate';
			// And provide wrapper that collects all the possible results.
			var wrapperNode = esprima.parse(
				'function makePredicate(words) {' +
				'  var generatedFn = _makePredicate(words);' +
				'  makePredicateCache[words] = generatedFn.toString();' +
				'  return generatedFn;' +
				'}'
			).body[0];
			path.insertAfter(wrapperNode);
			return false;
		} else {
			this.traverse(path);
		}
	}
});

// Execute instrumented code and collect possible predicates.
vm.runInNewContext(
	recast.prettyPrint(ast).code,
	{makePredicateCache: makePredicateCache}
);

// Remove wrapper.
makePredicatePath.parentPath.get(makePredicatePath.name + 1).replace();

// Rename original function back.
makePredicatePath.get('id').node.name = 'makePredicate';

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