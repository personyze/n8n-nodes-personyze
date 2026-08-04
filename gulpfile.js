const path = require('path');
const { task, src, dest } = require('gulp');

// tsc emits only .js; the icons each node references have to be carried across
// by hand or the node renders without one.
task('build:icons', copyIcons);

function copyIcons() {
	// Credentials carry an icon of their own now -- the community-node scanner
	// requires one -- so both trees have to be walked.
	return src([path.resolve('nodes', '**', '*.{png,svg}'), path.resolve('credentials', '**', '*.{png,svg}')],
	           { base: '.' })
		.pipe(dest(path.resolve('dist')));
}
