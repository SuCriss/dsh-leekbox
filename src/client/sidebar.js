// 韭菜盒子 LeekBox — 客户端 bundle 源码：侧边栏入口
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。

function sidebarRoot() {
	const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
	if (column === null) return void 0;
	return column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild;
}
function newSessionButton(root) {
	const nested = root.querySelector("button[class*=\"newSession\"]");
	if (nested !== null) return nested;
	for (const child of root.children) if (child.tagName === "BUTTON") return child;
}
function createEntry(options) {
	const entry = document.createElement("button");
	entry.type = "button";
	entry.setAttribute(options.rowAttribute, "");
	if (options.plugin !== void 0) {
		entry.setAttribute("data-dsh-plugin", options.plugin);
		entry.setAttribute("data-dsh-part", "sidebar-entry");
	}
	entry.className = options.css["entry"] ?? "";
	entry.setAttribute("aria-label", options.label());
	if (options.tooltip !== void 0) entry.setAttribute("title", options.tooltip());
	entry.innerHTML = "<span class=\"" + (options.css["entryIcon"] ?? "") + "\">" + options.icon + "</span><span class=\"" + (options.css["entryLabel"] ?? "") + "\">" + options.label() + "</span>";
	entry.addEventListener("click", options.onToggle);
	return entry;
}
function placeEntry(root, entry, options) {
	const button = newSessionButton(root);
	if (button === void 0) return false;
	if (entry.parentElement !== root) {
		const row = button.closest('[class*="logoRow"]');
		const base = row !== null && row.parentElement === root ? row : button;
		const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(options.familySelectors.join(", ")));
		const anchor =
			options.position === "before"
				? family.length > 0
					? family[0]
					: base.nextElementSibling
				: family.length > 0
					? family[family.length - 1].nextElementSibling
					: base.nextElementSibling;
		root.insertBefore(entry, anchor);
	}
	return true;
}
export function mountSidebarEntry(options) {
	if (typeof document !== "undefined" && document.querySelector(options.rowSelector) !== null) return () => {};
	const entry = createEntry(options);
	let root;
	let placed = false;
	const tryPlace = () => {
		if (root !== void 0 && !root.isConnected) {
			rootObserver.disconnect();
			root = void 0;
			placed = false;
		}
		if (placed) {
			if (document.body.contains(entry)) return;
			rootObserver.disconnect();
			root = void 0;
			placed = false;
		}
		root ??= sidebarRoot();
		if (root === void 0) return;
		placed = placeEntry(root, entry, options);
		if (placed) rootObserver.observe(root, { childList: true, subtree: true });
	};
	const waitObserver = new MutationObserver(() => {
		tryPlace();
	});
	waitObserver.observe(document.body, { childList: true, subtree: true });
	const rootObserver = new MutationObserver(() => {
		if (root === void 0 || !root.isConnected) {
			placed = false;
			tryPlace();
			return;
		}
		if (!root.contains(entry)) placed = placeEntry(root, entry, options);
	});
	tryPlace();
	return () => {
		waitObserver.disconnect();
		rootObserver.disconnect();
		entry.remove();
	};
}
