const path = require('path');
const { task, src, dest } = require('gulp');

// tsc emits only .js; the icons each node references have to be carried across
// by hand or the node renders without one.
task('build:icons', copyIcons);

function copyIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');
	return src(nodeSource).pipe(dest(nodeDestination));
}
