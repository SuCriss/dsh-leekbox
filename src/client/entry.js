// 韭菜盒子 LeekBox — 客户端 bundle 源码：插件入口（apply/inject）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import "./styles.js";
import { startSessionClock } from "./core.js";
import { mountPanel } from "./panel.js";
import { mountAlertWatcher } from "./watchlist-tab.js";
import { mountSidebarEntry } from "./sidebar.js";

export const inject = [];
const ENTRY_CSS = {
	entry: "lkb_entry",
	entryIcon: "lkb_entryIcon",
	entryLabel: "lkb_entryLabel",
};
const ICON = "🥬";
const ENTRY_SELECTOR = "[data-dsh-leekbox-entry]";

export function apply(ctx) {
	const panel = mountPanel();
	// 这两件事必须随**插件**存活，而不是随面板：面板一关 root.unmount()，
	// 挂在面板里的价格预警看护就跟着卸载了（README 承诺的"交易时段自动盯盘"
	// 会静默失效）。同理，交易日历的拉取与"回到前台补拉"也不该绑在面板生命周期上。
	const sessionClock = startSessionClock();
	const alertWatcher = mountAlertWatcher();
	const disposers = [];
	try {
		disposers.push(
			mountSidebarEntry({
				rowAttribute: "data-dsh-leekbox-entry",
				rowSelector: ENTRY_SELECTOR,
				plugin: "leekbox",
				icon: ICON,
				css: ENTRY_CSS,
				label: () => "韭菜盒子",
				tooltip: () => "韭菜盒子：A股行情 / 选股 / 自选 / 7×24快讯",
				onToggle: () => panel.toggle(),
				position: "after",
				familySelectors: ["[data-dsh-taskboard-entry]", "[data-dsh-ssh-entry]", "[data-dsh-skill-explorer-entry]", "[data-dsh-leekbox-entry]"],
			})
		);
		disposers.push(() => alertWatcher.dispose());
		disposers.push(() => sessionClock());
		disposers.push(() => panel.dispose());
	} catch (error) {
		console.warn("[leekbox] mount failed:", error);
	}
	ctx.effect(
		() => () => {
			for (const dispose of disposers.splice(0)) dispose();
		},
		"leekbox: ui mounts"
	);
}
