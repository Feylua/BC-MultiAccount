import { readChildId } from "./core/input.js";
import { initParent } from "./parent/index.js";
import { initChild } from "./child/index.js";

if (window.self !== window.top) {
	const id = readChildId();
	if (id) initChild(id);
} else {
	initParent();
}
