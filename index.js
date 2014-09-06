'use strict';

if (process.argv.length < 3) {
	console.log('Usage: acorn-csp <path to acorn> <destination filename>');
	process.exit(1);
}

Error.stackTraceLimit = 100;

var vm = require('vm');
var srcPath = process.argv[3] || require.resolve('acorn');
var destPath = process.argv[2];
var esprima = require('esprima');
var recast = require('recast');
var fs = require('fs');

var source = fs.readFileSync(srcPath, 'utf-8');
var ast = recast.parse(source, {esprima: esprima});

var makePredicatePath;

recast.visit(ast, {
	visitFunctionDeclaration: function (path) {
		var node = path.node;
		if (node.id.name === 'makePredicate') {
			// Found makePredicate function, instrument it with postMessage to sandbox.
			makePredicatePath = path;
			node.id.name = '_makePredicate';
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

var makePredicateCache = {};

vm.runInNewContext(
	recast.prettyPrint(ast).code,
	{makePredicateCache: makePredicateCache}
);

makePredicatePath.get("id").node.name = 'makePredicate';

makePredicatePath.get("body", "body").replace([{
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
		property: makePredicatePath.get("params", 0).node
	}
}]);

makePredicatePath.parentPath.get(makePredicatePath.name + 1).replace();

fs.writeFileSync(destPath, recast.print(ast).code);