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

// The codex files (`*.node.json`) are the other thing tsc does not emit, and
// `files: ["dist"]` in package.json means anything not copied here is simply not
// in the published package. Up to 0.1.2 they were not copied at all: the repo had
// them, npm did not, so the categories and documentation links that are supposed
// to place the node in n8n's UI shipped as nothing. Reviewers read the repo, which
// is why it took until submission review to notice.
task('build:codex', copyCodex);

function copyCodex() {
	return src([path.resolve('nodes', '**', '*.node.json')], { base: '.' })
		.pipe(dest(path.resolve('dist')));
}

task('build:assets', require('gulp').parallel('build:icons', 'build:codex'));
