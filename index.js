#!/usr/bin/env node

'use strict';

var srcPath = process.argv[3] || require.resolve('acorn');
var destPath = process.argv[2];

if (!destPath) {
	console.log('Usage: acorn-csp <path to acorn> <destination filename>');
	process.exit(1);
}

var vm = require('vm');
var esprima = require('esprima');
var recast = require('recast');
var fs = require('fs');

// Reading original Acorn's source with conservative parser (recast).
var source = fs.readFileSync(srcPath, 'utf-8');
var ast = recast.parse(source, {esprima: esprima});

var makePredicatePath;

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
var makePredicateCache = {};

vm.runInNewContext(
	recast.prettyPrint(ast).code,
	{makePredicateCache: makePredicateCache}
);

// Remove wrapper.
makePredicatePath.parentPath.get(makePredicatePath.name + 1).replace();

// Rename original function back.
makePredicatePath.get('id').node.name = 'makePredicate';

// And generate it's body as hash of collected possible inputs/outputs.
makePredicatePath.get('body', 'body').replace([{
	type: 'ReturnStatement',
	argument: {
		type: 'MemberExpression',
		object: {
			type: 'ObjectExpression',
			properties: Object.keys(makePredicateCache).map(function (key) {
				var fnNode = esprima.parse('(' + this[key] + ')').body[0].expression;
				fnNode.id = null;
				return {
					type: 'Property',
					kind: 'init',
					key: {type: 'Literal', value: key},
					value: fnNode
				};
			}, makePredicateCache)
		},
		computed: true,
		property: makePredicatePath.get('params', 0).node
	}
}]);

// Finally, save transformed AST to file with preserved formatting.
fs.writeFileSync(destPath, recast.print(ast).code);

console.log('Generated successfully!');