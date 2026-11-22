import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";

const root = import.meta.dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");

const meta = fs.readFileSync(path.join(root, "userscript.meta.js"), "utf8")
	.replaceAll("__VERSION__", pkg.version);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const options = {
	absWorkingDir: root,
	entryPoints: ["src/main.js"],
	bundle: true,
	format: "iife",
	target: "es2022",
	outfile: "dist/BC-MultiAccount.user.js",
	banner: { js: meta },
	loader: { ".css": "text" },
	define: {
		__VERSION__: JSON.stringify(pkg.version),
	},
	sourcemap: watch ? "inline" : false,
	minify: false,
	legalComments: "none",
	logLevel: "info",
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log("Watching src/ ...");
} else {
	await esbuild.build(options);
	console.log(`Built dist/BC-MultiAccount.user.js (v${pkg.version})`);
}
