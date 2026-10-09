// 韭菜盒子 LeekBox — 客户端 bundle 源码：自选星标按钮
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h } from "./react.js";
import { API, api, lkbConfirm } from "./core.js";

export function StarButton({ code, name, on, confirmText }) {
	return h(
		"button",
		{
			className: "lkb-star",
			"data-on": on ? "true" : "false",
			title: on ? "移出自选" : "加入自选",
			onClick: (e) => {
				e.stopPropagation();
				const proceed = on && confirmText ? lkbConfirm(confirmText) : Promise.resolve(true);
				proceed
					.then((ok) => {
						if (!ok) return;
						return api(API.watchlist + (on ? "/remove" : "/add"), { method: "POST", body: { code, name } }).then(() => {
							// Instant feedback everywhere: the panel's watchlist poll
							// only runs every 20s — broadcast so all stars refresh now.
							window.dispatchEvent(new Event("leekbox:watchlist-changed"));
						});
					})
					.catch(() => {});
			},
		},
		on ? "★" : "☆"
	);
}
