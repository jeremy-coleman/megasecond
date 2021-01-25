import commonjs from "@rollup/plugin-commonjs";
import copy from "rollup-plugin-copy";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";


const staticSourceFiles = ["client/index.html", "client/asset"];
const destDir = "dist";
const sourcemap = true;

export default {
    external: ["babylonjs", "colyseus.js"],
    input: "client/index.ts",
    output: {
        sourcemap: sourcemap,
        format: "iife",
        name: "bundle",
        file: `${destDir}/bundle.js`,
        globals: { "babylonjs": "BABYLON", "colyseus.js": "Colyseus" }
    },
    plugins: [
        resolve({
            extensions: [".js", ".ts"],
            browser: true, 
            preferBuiltins: true,

        }),
        commonjs(),
        typescript({
            sourceMap: sourcemap,
            inlineSources: false,
        }),
        copy({
            targets: [
                ...staticSourceFiles.map((f) => ({ src: f, dest: destDir })), //
                { src: "node_modules/colyseus.js/dist/colyseus.js", dest: `${destDir}/lib/` },
            ],
        }),
    ],
    watch: {
        include: "client/**"
    }
};