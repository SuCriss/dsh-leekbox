// 韭菜盒子 LeekBox — browser half.
//
// Runs inside the dsh web GUI. Injects a sidebar entry row and mounts a
// full A-share dashboard overlay panel: indices, quotes/search, watchlist,
// screener, and the 7x24 news feed, all served through the host's
// /api/leekbox/* routes (see ../index.js).
window.__ModuleLoader__.load({
	id: "dsh-leekbox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_dom_client = require("react-dom/client");
		const { useState, useEffect, useRef, useCallback, useMemo } = react;
		const h = react.createElement;
		const createRoot = react_dom_client.createRoot;

		//#region styles
		const CSS = `
.lkb_entry{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 10px;font-size:13px;display:flex}
.lkb_entry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.lkb_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex;font-size:16px;line-height:1}
.lkb_entryLabel{text-overflow:ellipsis;overflow:hidden}
[data-dsh-frame][data-sidebar-collapsed] .lkb_entry{border-radius:50%;justify-content:center;width:36px;height:36px;margin:0 auto 12px;padding:0}
[data-dsh-frame][data-sidebar-collapsed] .lkb_entryLabel{display:none}
.lkb_overlay{background:var(--dsw-alias-bg-mask-2,#080a1073);z-index:9999;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;display:block;position:fixed;inset:0}
.lkb_card{background:var(--dsw-alias-bg-overlay,#fdfdfd);width:min(980px,94vw);max-width:min(980px,calc(100vw - 16px));max-height:88vh;color:var(--dsw-alias-label-primary,#1c1e26);border-radius:14px;flex-direction:column;display:flex;overflow:hidden;box-shadow:0 20px 70px #00000059;position:fixed;z-index:10000;margin:0}
.lkb_head{background:var(--dsw-alias-bg-base,#fff);align-items:center;gap:12px;padding:12px 18px;display:flex;border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed);cursor:grab;touch-action:none;user-select:none}
.lkb_head:active{cursor:grabbing}
.lkb_headTitle{margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.lkb_headTitle .lkb-logo{font-size:18px}
.lkb_headSub{color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px;font-weight:400}
.lkb_headRight{margin-left:auto;display:flex;align-items:center;gap:10px}
.lkb_mktStatus{font-size:11px;padding:3px 10px;border-radius:99px;background:var(--dsw-alias-bg-layer-1,#f2f3f5);color:var(--dsw-alias-label-secondary,#6b7280)}
.lkb_mktStatus[data-open="true"]{background:#ecfdf5;color:#0f7a50}
.lkb_mktStatus[data-open="false"]{background:#f2f3f5;color:#8a8f9c}
.lkb_close{cursor:pointer;background:0 0;border:none;color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:20px;line-height:1;padding:4px 8px;border-radius:6px}
.lkb_close:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5);color:var(--dsw-alias-label-primary)}
.lkb_tabs{display:flex;gap:4px;padding:10px 18px 0;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed)}
.lkb_tab{border:1px solid transparent;color:var(--dsw-alias-label-secondary,#8a8f9c);cursor:pointer;background:0 0;border-radius:8px 8px 0 0;padding:7px 16px;font-size:13px;font-weight:500}
.lkb_tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f5f6f8)}
.lkb_tab[data-active="true"]{color:var(--dsw-alias-label-primary,#1c1e26);font-weight:600;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border-color:var(--dsw-alias-border-l1,#e8e9ed);border-bottom-color:transparent}
.lkb_body{padding:14px 18px 10px;overflow:auto;background:var(--dsw-alias-bg-layer-1,#f7f8fa);flex:1}
.lkb-stickyTop{position:sticky;top:-14px;z-index:8;background:var(--dsw-alias-bg-layer-1,#f7f8fa);margin:-14px -18px 10px;padding:10px 18px 6px;display:flex;flex-direction:column;gap:7px;box-shadow:0 10px 16px -14px #00000047;border-bottom:1px solid var(--dsw-alias-border-l1,#eceef1)}
.lkb-headRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lkb-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lkb-pill{display:inline-flex;align-items:baseline;gap:5px;font-size:12px;padding:4px 11px;border-radius:99px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);color:var(--dsw-alias-label-secondary,#8a8f9c);white-space:nowrap}
.lkb-pill b{font-weight:700;font-variant-numeric:tabular-nums}
.lkb-pill .lkb-up{color:#e03131}
.lkb-pill .lkb-down{color:#0f9d6e}
.lkb-banner{display:flex;align-items:center;gap:6px;font-size:12px;padding:7px 12px;border-radius:10px;background:linear-gradient(90deg,#eef2ff,#f8faff);border:1px solid #d6defa;color:#4353a3;font-weight:600}
.lkb-banner .lkb-code{font-weight:500}
body[data-ds-dark-theme] .lkb-banner{background:#6378dc26;border-color:#6378dc55;color:#a5b4fc}
.lkb_foot{background:var(--dsw-alias-bg-base,#fff);border-top:1px solid var(--dsw-alias-border-l1,#e8e9ed);padding:8px 18px;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;display:flex;justify-content:space-between;gap:8px}
.lkb_card table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--dsw-alias-bg-base,#fff);border-radius:10px;overflow:hidden}
.lkb_card th{color:var(--dsw-alias-label-tertiary,#a2a7b3);text-align:right;font-weight:600;font-size:11px;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed);white-space:nowrap;position:sticky;top:0;background:var(--dsw-alias-bg-base,#fff)}
.lkb_card th:first-child,.lkb_card td:first-child{text-align:left}
.lkb_card td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1,#f2f3f5);white-space:nowrap;font-variant-numeric:tabular-nums}
.lkb_card tbody tr{cursor:pointer;transition:background .12s,box-shadow .12s;animation:lkb-rowIn .22s ease-out backwards}
.lkb_card tbody tr:hover{background:#f8f9fd;box-shadow:inset 2px 0 0 #4c6ef5}
@keyframes lkb-rowIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.lkb_name{font-weight:600;color:var(--dsw-alias-label-primary)}
.lkb_code{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-left:6px}
.lkb-up{color:#e03131}
.lkb-down{color:#0f9d6e}
/* ---- 报价板单元格(行情页) ---- */
.lkb-pct{display:inline-block;min-width:56px;text-align:center;font-weight:600;font-size:12px;padding:2px 7px;border-radius:6px;font-variant-numeric:tabular-nums;letter-spacing:.01em}
.lkb-pct.lkb-up{background:#e0313112;color:#d92d20}
.lkb-pct.lkb-down{background:#0f9d6e12;color:#0b8059}
.lkb-chipLabel{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.06em;font-weight:600;align-self:center;margin-right:3px}
body[data-ds-dark-theme] .lkb-pct.lkb-up{background:#e0313130;color:#ff8787}
body[data-ds-dark-theme] .lkb-pct.lkb-down{background:#0f9d6e30;color:#63e6be}
	/* ---- 大盘页市场情绪温度计(分段弧形仪表 + 无框数据行) ---- */
	.lkb-thermo{display:flex;gap:4px;align-items:center;flex-wrap:wrap;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 16px;margin-bottom:12px}
	.lkb-gauge{flex:none;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:196px}
	.lkb-gaugeScore{display:flex;align-items:baseline;gap:8px}
	.lkb-gaugeVal{font-size:32px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--lkb-tier-fg,#1c1e26)}
	.lkb-gaugeTier{font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;background:var(--lkb-tier-bg,#f1f3f5);color:var(--lkb-tier-fg,#495057);white-space:nowrap;cursor:default}
	.lkb-thermoStats{flex:1;min-width:320px;display:flex;align-items:stretch;flex-wrap:wrap;row-gap:8px}
	.lkb-tStat{flex:1;min-width:104px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 14px;border-left:1px solid var(--dsw-alias-border-l1,#eceef1)}
	.lkb-tStat:first-child{border-left:0;padding-left:4px}
	.lkb-tLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.05em;white-space:nowrap}
	.lkb-tValue{font-size:21px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1c1e26);white-space:nowrap}
	.lkb-tValue b{font-weight:700}
	.lkb-tValue i{font-style:normal;font-weight:400;font-size:14px;color:var(--dsw-alias-label-tertiary,#c0c4cc);margin:0 3px}
	.lkb-tBar{height:4px;border-radius:99px;background:#0f9d6e33;overflow:hidden;margin-top:1px}
	.lkb-tBarUp{height:100%;border-radius:99px;background:#e03131;transition:width .6s ease}
	body[data-ds-dark-theme] .lkb-thermo{background:#3a3a3c;border-color:#ffffff14}
	body[data-ds-dark-theme] .lkb-tStat{border-color:#ffffff0f}
	body[data-ds-dark-theme] .lkb-tBar{background:#0f9d6e45}
.lkb-star{cursor:pointer;background:0 0;border:none;font-size:14px;padding:2px 4px;opacity:.55}
.lkb-star:hover{opacity:1}
.lkb-star[data-on="true"]{opacity:1}
.lkb-searchWrap{position:relative;margin-bottom:12px}
.lkb-searchRow{display:flex;gap:8px;align-items:center;position:relative;z-index:31}
/* Opaque underlay: some DSH skins remap --dsw-alias-bg-base to a translucent
 * glass color (alpha can be 0), which would make the dropdown see-through.
 * Paint the alias over a solid base and flip the base in dark mode. */
.lkb-searchInput{background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff}
body[data-ds-dark-theme] .lkb-searchInput{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
.lkb-input.lkb-searchInput{border-radius:10px;padding:8px 34px 8px 32px;font-size:13px}
.lkb-searchGlass{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:13px;pointer-events:none}
.lkb-searchClear{position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;background:var(--dsw-alias-bg-layer-1,#eef0f3);border:none;color:var(--dsw-alias-label-secondary,#8a8f9c);width:20px;height:20px;border-radius:50%;font-size:11px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.lkb-searchClear:hover{background:var(--dsw-alias-interactive-bg-hover,#e2e5ea);color:var(--dsw-alias-label-primary)}
.lkb-srCard{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff;border:1px solid var(--dsw-alias-border-l1,#e5e7ec);border-radius:12px;box-shadow:0 14px 40px #00000026;overflow:hidden}
body[data-ds-dark-theme] .lkb-srCard{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
/* In-panel confirm dialog (lkbConfirm) — modal mask + card */
.lkb_confirmMask{position:fixed;inset:0;z-index:2147483646;background:var(--dsw-alias-bg-mask-1,#0000003d);display:flex;align-items:center;justify-content:center}
.lkb_confirmBox{min-width:260px;max-width:340px;background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff;border:1px solid var(--dsw-alias-border-l1,#e5e7ec);border-radius:12px;box-shadow:0 18px 50px #00000040;padding:16px}
body[data-ds-dark-theme] .lkb_confirmBox{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
.lkb_confirmText{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#17264a);white-space:pre-wrap;word-break:break-all}
.lkb_confirmBtns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.lkb-srMeta{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3);font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f9c)}
.lkb-srQuery{font-weight:600;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-srNote{display:inline-flex;align-items:center;gap:6px}
.lkb-srClear{cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l1,#e3e5e9);color:var(--dsw-alias-label-secondary,#8a8f9c);border-radius:99px;padding:1px 10px;font-size:11px}
.lkb-srClear:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary,#b7bcc7)}
.lkb-srList{max-height:min(430px,52vh);overflow:auto;padding:4px 6px 6px}
.lkb-srItem{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:9px;cursor:pointer}
.lkb-srItem:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.lkb-srItem + .lkb-srItem{margin-top:1px}
.lkb-srBadge{flex:none;width:40px;text-align:center;font-size:10px;font-weight:600;border-radius:6px;padding:2px 0;letter-spacing:.02em}
.lkb-srBadge.t-stock{background:#e8f6ee;color:#0f7a50}
.lkb-srBadge.t-etf{background:#eef2ff;color:#4353a3}
.lkb-srBadge.t-cb{background:#fff4e5;color:#b25e09}
.lkb-srBadge.t-lof{background:#f1f0fb;color:#6b5fa8}
body[data-ds-dark-theme] .lkb-srBadge.t-stock{background:#0f7a5030;color:#4ade80}
body[data-ds-dark-theme] .lkb-srBadge.t-etf{background:#4353a340;color:#a5b4fc}
body[data-ds-dark-theme] .lkb-srBadge.t-cb{background:#b25e0930;color:#fbbf24}
body[data-ds-dark-theme] .lkb-srBadge.t-lof{background:#6b5fa840;color:#c4b5fd}
.lkb-srId{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lkb-srQuote{flex:none;display:inline-flex;align-items:baseline;gap:7px;font-variant-numeric:tabular-nums;text-align:right}
.lkb-srPrice{font-weight:600;font-size:12.5px}
.lkb-srPct{font-size:11.5px;min-width:52px}
.lkb-srQuote:not(.lkb-up):not(.lkb-down) .lkb-srPrice,.lkb-srQuote:not(.lkb-up):not(.lkb-down) .lkb-srPct{color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-srStar{flex:none}
.lkb-srEmpty{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:12px;padding:18px 14px;text-align:center;line-height:1.6}
.lkb-srSkeletons{padding:6px}
.lkb-srSkeleton{height:30px;border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,#f1f2f4) 25%,var(--dsw-alias-interactive-bg-hover,#e9ebef) 45%,var(--dsw-alias-bg-layer-1,#f1f2f4) 65%);background-size:280% 100%;animation:lkb-shimmer 1.2s infinite linear;margin:4px 2px}
@keyframes lkb-shimmer{0%{background-position:120% 0}100%{background-position:-120% 0}}
.lkb-input{box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);width:100%;color:var(--dsw-alias-label-primary,#1c1e26);border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:8px;padding:7px 12px;font-size:13px;outline:none}
.lkb-input:focus{border-color:#4c6ef5;box-shadow:0 0 0 3px #4c6ef520}
.lkb-chip{cursor:pointer;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#dcdfe5);color:var(--dsw-alias-label-secondary,#5f6672);border-radius:99px;padding:3px 11px;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;transition:border-color .12s, background .12s, color .12s}
.lkb-chip:hover{border-color:#bac8ff;color:#364fc7}
.lkb-chip[data-active="true"]{background:#eef2ff;border-color:#91a4f5;color:#364fc7;font-weight:600}
.lkb-chipRow{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;align-items:center}
.lkb-empty{color:var(--dsw-alias-label-tertiary,#a2a7b3);text-align:center;padding:36px 0;font-size:13px}
.lkb-error{color:#d92d20;text-align:center;padding:16px;font-size:12.5px}
.lkb-status{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11.5px;padding:6px 2px;display:flex;gap:12px;align-items:center}
.lkb-btn{cursor:pointer;background:#111;color:#fff;border:1px solid transparent;border-radius:8px;padding:7px 16px;font-size:12.5px;white-space:nowrap}
.lkb-btn:hover{background:#2a2a2c}
.lkb-btnGhost{cursor:pointer;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:8px;padding:7px 14px;font-size:12.5px;white-space:nowrap}
.lkb-btnGhost:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.lkb-btn:disabled,.lkb-btnGhost:disabled{opacity:.5;cursor:default}
.lkb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
.lkb-indexCard{position:relative;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:14px 16px;cursor:pointer;overflow:hidden;transition:border-color .15s, box-shadow .15s, transform .15s}
.lkb-indexCard::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--lkb-dir,#ced4da)}
.lkb-indexCard:hover{border-color:#bac8ff;box-shadow:0 4px 18px #4c6ef517;transform:translateY(-1px)}
.lkb-indexName{font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.lkb-indexName .lkb-tag{font-size:10px;color:var(--dsw-alias-label-tertiary,#a2a7b3);background:var(--dsw-alias-bg-layer-1,#f2f3f5);padding:2px 8px;border-radius:99px;font-weight:400}
.lkb-indexValue{font-size:24px;font-weight:700;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.lkb-indexChange{font-size:13px;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px}
.lkb-indexArrow{font-size:11px;font-weight:700}
.lkb-indexMeta{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-top:8px;display:flex;gap:10px}
.lkb-detailHead{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.lkb-detailName{font-size:17px;font-weight:700}
.lkb-detailQuote{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-qItem .lkb-qLabel{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-bottom:2px}
.lkb-qItem .lkb-qValue{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.lkb-chartBox{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-chartTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6672);display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.lkb-periodRow{display:flex;gap:4px}
.lkb-period{font-size:11px;cursor:pointer;padding:2px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary,#8a8f9c);background:0 0;border:1px solid transparent}
.lkb-period[data-active="true"]{background:#eef2ff;color:#4353a3;font-weight:600}
.lkb-newsItem{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:10px 14px;margin-bottom:8px}
.lkb-newsMeta{display:flex;gap:8px;align-items:center;margin-bottom:5px;font-size:11px;color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-newsTag{background:#eef2ff;color:#4353a3;border-radius:99px;padding:1px 8px;font-size:10px}
.lkb-newsText{font-size:12.8px;line-height:1.65;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-newsStocks{margin-top:7px;display:flex;gap:6px;flex-wrap:wrap}
.lkb-stockChip{cursor:pointer;font-size:11px;color:#4353a3;background:#eef2ff;border-radius:99px;padding:2px 10px}
.lkb-stockChip:hover{background:#dfe6ff}
.lkb-filters{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-filter{display:flex;flex-direction:column;gap:4px}
.lkb-filter label{font-size:11px;color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-pager{display:flex;justify-content:center;gap:8px;padding:10px 0}
.lkb-filterCard{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.lkb-secTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6672);margin-bottom:8px}
.lkb-sigGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:6px}
.lkb-check{cursor:pointer;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l1,#e3e5e9);color:var(--dsw-alias-label-secondary,#5f6672);border-radius:8px;padding:6px 10px;font-size:12px;display:flex;gap:6px;align-items:center;user-select:none}
.lkb-check input{margin:0;accent-color:#4c6ef5}
.lkb-check[data-on="true"]{background:#eef2ff;border-color:#c7d2fe;color:#4353a3;font-weight:600}
.lkb-runRow{display:flex;gap:10px;align-items:flex-end;margin-bottom:10px;flex-wrap:wrap}
.lkb-progressWrap{margin-bottom:10px}
.lkb-progress{height:5px;background:var(--dsw-alias-bg-layer-1,#eef0f3);border-radius:99px;overflow:hidden;margin-top:6px}
.lkb-progressBar{height:100%;background:#4c6ef5;transition:width .3s}
.lkb-score{display:inline-block;min-width:36px;text-align:center;font-weight:700;font-size:13px;padding:2px 6px;border-radius:6px;background:#eef2ff;color:#4353a3;font-variant-numeric:tabular-nums}
body[data-ds-dark-theme] .lkb_card,body[data-ds-dark-theme] .lkb_head,body[data-ds-dark-theme] .lkb_tabs,body[data-ds-dark-theme] .lkb_foot{background:#2c2c2e}
body[data-ds-dark-theme] .lkb_body{background:#1e1e1e}
body[data-ds-dark-theme] .lkb_card table,body[data-ds-dark-theme] .lkb_indexCard,body[data-ds-dark-theme] .lkb_detailQuote,body[data-ds-dark-theme] .lkb_chartBox,body[data-ds-dark-theme] .lkb_newsItem,body[data-ds-dark-theme] .lkb_filters,body[data-ds-dark-theme] .lkb_input{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb_card th{background:#3a3a3c;border-color:#ffffff0f}
body[data-ds-dark-theme] .lkb_card td{border-color:#ffffff0d}
body[data-ds-dark-theme] .lkb_card tbody tr:hover,body[data-ds-dark-theme] .lkb_close:hover,body[data-ds-dark-theme] .lkb_tab:hover,body[data-ds-dark-theme] .lkb-btnGhost:hover{background:#ffffff12}
body[data-ds-dark-theme] .lkb_card tbody tr:hover{box-shadow:inset 2px 0 0 #6378dc}
body[data-ds-dark-theme] .lkb-chip{background:#2c2c2e;border-color:#ffffff14;color:#c0c4cc}
body[data-ds-dark-theme] .lkb-chip:hover{border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb_tab[data-active="true"]{color:#fff;background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-btn{color:#111827;background:#e5e5ea}
body[data-ds-dark-theme] .lkb-btn:hover{background:#d1d5db}
body[data-ds-dark-theme] .lkb-mktStatus[data-open="true"]{background:#30d15826;color:#30d158}
body[data-ds-dark-theme] .lkb-chip[data-active="true"],body[data-ds-dark-theme] .lkb-period[data-active="true"]{background:#6378dc38;color:#a5b4fc;border-color:#6378dc66}
body[data-ds-dark-theme] .lkb-newsTag,body[data-ds-dark-theme] .lkb-stockChip{color:#a5b4fc;background:#6378dc38}
body[data-ds-dark-theme] .lkb-stockChip:hover{background:#6378dc5c}
body[data-ds-dark-theme] .lkb-filterCard,body[data-ds-dark-theme] .lkb-check{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-check[data-on="true"],body[data-ds-dark-theme] .lkb-score{background:#6378dc38;color:#a5b4fc;border-color:#6378dc66}
body[data-ds-dark-theme] .lkb-progressBar{background:#6378dc}
.lkb-win{position:fixed;background:var(--dsw-alias-bg-overlay,#fdfdfd);color:var(--dsw-alias-label-primary,#1c1e26);border-radius:14px;width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px #00000066;animation:lkb-pop .14s ease-out;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
@keyframes lkb-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.lkb-mktTag{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8f9c);background:var(--dsw-alias-bg-layer-1,#f2f3f5);padding:2px 8px;border-radius:99px;font-weight:500}
.lkb-hero{display:flex;gap:18px;align-items:stretch;flex-wrap:wrap;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 16px;margin-bottom:12px}
.lkb-heroMain{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:150px}
.lkb-heroPrice{font-size:32px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.lkb-heroSub{font-size:13.5px;font-weight:600;display:flex;gap:10px;font-variant-numeric:tabular-nums}
.lkb-heroMeta{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px}
.lkb-heroGrid{flex:1;min-width:300px;display:grid;grid-template-columns:repeat(auto-fill,minmax(102px,1fr));gap:6px 16px;align-content:center}
.lkb-kTip{position:absolute;z-index:6;pointer-events:none;background:var(--dsw-alias-bg-overlay,#fdfdfd);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:7px 12px;box-shadow:0 8px 28px #00000033;display:grid;grid-template-columns:auto auto;gap:3px 12px;font-size:11.5px;line-height:1.25;color:var(--dsw-alias-label-secondary,#5f6672);font-variant-numeric:tabular-nums;white-space:nowrap}
.lkb-kTip .tipDate{grid-column:1/-1;font-weight:700;color:var(--dsw-alias-label-primary,#1c1e26);margin-bottom:2px}
.lkb-kTip b{font-weight:600;text-align:right;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-kTip b.lkb-up{color:#e03131}
.lkb-kTip b.lkb-down{color:#0f9d6e}
.lkb-kTip .srRes{color:#e03131;font-weight:600}
.lkb-kTip .srSup{color:#0f9d6e;font-weight:600}
.lkb-kTip .ma5{color:#e8590c}
.lkb-kTip .ma10{color:#4263eb}
.lkb-kTip .ma20{color:#9c36b5}
body[data-ds-dark-theme] .lkb-kTip{background:#3a3a3c;border-color:#ffffff1f;box-shadow:0 8px 28px #00000066}
body[data-ds-dark-theme] .lkb-kTip b,body[data-ds-dark-theme] .lkb-kTip .tipDate{color:#f1f1f2}
.lkb-kwrap{position:relative}
.lkb-kaxis{position:relative;height:16px;margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-variant-numeric:tabular-nums}
.lkb-kaxis span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
body[data-ds-dark-theme] .lkb-win{background:#2c2c2e;box-shadow:0 24px 80px #000000cc}
body[data-ds-dark-theme] .lkb-win .lkb_head{background:#2c2c2e}
body[data-ds-dark-theme] .lkb-hero{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-mktTag{background:#3a3a3c;color:#a2a7b3}
.lkb-srcBadge{flex:none;font-size:10px;padding:1px 8px;border-radius:99px;background:#eef2ff;color:#4353a3}
.lkb-newsFlag{flex:none;background:#e03131;color:#fff;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}
.lkb-newsItem.lkb-newsImportant{border-color:#f3b0b0;background:#fff6f6;box-shadow:inset 3px 0 0 #e03131}
.lkb-newsImportant .lkb-newsText{font-weight:600}
body[data-ds-dark-theme] .lkb-newsImportant{background:#3a2626;border-color:#e0313166}
body[data-ds-dark-theme] .lkb-srcBadge{background:#6378dc38;color:#a5b4fc}
/* ---- screener ---- */
.lkb-sc{display:flex;flex-direction:column;gap:12px}
.lkb-scHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:2px 2px 0}
.lkb-scTitle{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.lkb-scSub{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11.5px;margin-top:3px;font-weight:400}
.lkb-scCard{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:13px}
.lkb-scDivider{height:1px;background:var(--dsw-alias-border-l1,#eceef1)}
.lkb-scRow{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.lkb-condBlock{display:flex;flex-direction:column;gap:7px}
.lkb-scFieldLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.05em;font-weight:600}
.lkb-seg{display:inline-flex;background:var(--dsw-alias-bg-layer-1,#f2f3f5);border-radius:9px;padding:3px;gap:2px;width:max-content}
.lkb-segBtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .12s, background .12s}
.lkb-segBtn:hover{color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-segBtn[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:#364fc7;font-weight:600;box-shadow:0 1px 3px #0000001f}
.lkb-scSelect{width:auto !important;min-width:132px;padding:6px 10px;font-size:12.5px}
.lkb-rangeGroup{display:flex;align-items:center;gap:6px}
.lkb-rangeGroup .lkb-input{width:78px;padding:6px 8px;font-size:12.5px;text-align:center}
.lkb-rangeTilde{color:#adb5bd;font-size:12px}
.lkb-unit{font-size:11.5px;color:var(--dsw-alias-label-secondary,#5f6672);white-space:nowrap}
.lkb-switch{cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#495057);user-select:none;height:26px}
.lkb-switchTrack{flex:none;width:32px;height:18px;border-radius:99px;background:#ced4da;position:relative;transition:background .18s}
.lkb-switchTrack::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 2px #00000040}
.lkb-switch[data-on="true"] .lkb-switchTrack{background:#4c6ef5}
.lkb-switch[data-on="true"] .lkb-switchTrack::after{left:16px}
.lkb-sigGroups{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}
.lkb-sigGroup{border:1px solid var(--dsw-alias-border-l1,#eceef1);border-radius:11px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fafbfc)}
.lkb-sigGroupTitle{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:700;color:var(--dsw-alias-label-secondary,#5f6672);margin-bottom:8px}
.lkb-sigCount{font-size:10px;border-radius:99px;padding:1px 7px;background:var(--dsw-alias-bg-layer-1,#f1f3f5);color:var(--dsw-alias-label-tertiary,#868e96);font-variant-numeric:tabular-nums;font-weight:600}
.lkb-sigCount[data-n="true"]{background:#eef2ff;color:#4353a3}
.lkb-chip2{cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#e3e5e9);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#495057);border-radius:8px;padding:5px 10px;font-size:12px;transition:border-color .12s, background .12s, color .12s;display:inline-flex;align-items:center;gap:6px}
.lkb-chip2:hover{border-color:#bac8ff;color:#364fc7}
.lkb-chip2[data-on="true"]{background:#eef2ff;border-color:#91a4f5;color:#364fc7;font-weight:600}
.lkb-chip2Dot{width:5px;height:5px;border-radius:50%;background:#ced4da;flex:none;transition:background .12s}
.lkb-chip2[data-on="true"] .lkb-chip2Dot{background:#4c6ef5}
.lkb-scActions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.lkb-scoreInput{width:56px !important;text-align:center;padding:6px 8px !important}
.lkb-runBtn{cursor:pointer;border:none;border-radius:9px;padding:9px 24px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#4c6ef5,#6741d9);box-shadow:0 2px 10px #4c6ef55c;transition:transform .1s, box-shadow .15s, filter .15s;letter-spacing:.02em}
.lkb-runBtn:hover{box-shadow:0 4px 16px #4c6ef573;filter:brightness(1.06)}
.lkb-runBtn:active{transform:translateY(1px)}
.lkb-runBtn:disabled{opacity:.55;cursor:default;transform:none}
.lkb-resCard{animation:lkb-pop .18s ease-out}
.lkb-resSummary{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#343a40);padding:2px 2px 8px}
.lkb-rankNum{display:inline-block;width:22px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#adb5bd)}
.lkb-rankNum[data-medal="1"]{color:#f08c00}
.lkb-rankNum[data-medal="2"]{color:#74a3d3}
.lkb-rankNum[data-medal="3"]{color:#c98a4b}
.lkb-scorePill{display:inline-block;min-width:36px;text-align:center;font-weight:700;font-size:12.5px;padding:3px 9px;border-radius:8px;font-variant-numeric:tabular-nums}
.lkb-scorePill[data-tier="0"]{background:#f1f3f5;color:#868e96}
.lkb-scorePill[data-tier="1"]{background:#edf2ff;color:#4263eb}
.lkb-scorePill[data-tier="2"]{background:#dbe4ff;color:#3b5bdb}
.lkb-scorePill[data-tier="3"]{background:#4c6ef5;color:#fff}
.lkb-signalTags{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:300px;margin-left:auto}
.lkb-signalTag{font-size:10.5px;color:#4353a3;background:#eef2ff;border-radius:6px;padding:2px 7px;white-space:nowrap}
.lkb-signalMore{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#868e96);align-self:center}
.lkb-emptyState{text-align:center;padding:44px 0;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:13px}
.lkb-emptyIcon{font-size:30px;margin-bottom:8px;opacity:.7}
body[data-ds-dark-theme] .lkb-scCard,body[data-ds-dark-theme] .lkb-sigGroup{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-seg{background:#242426}
body[data-ds-dark-theme] .lkb-segBtn[data-active="true"]{background:#ffffff1f;color:#dbe4ff;box-shadow:none}
body[data-ds-dark-theme] .lkb-chip2,body[data-ds-dark-theme] .lkb-switchTrack{background:#2c2c2e}
body[data-ds-dark-theme] .lkb-chip2{border-color:#ffffff14;color:#c0c4cc}
body[data-ds-dark-theme] .lkb-chip2:hover{border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-chip2[data-on="true"]{background:#6378dc38;border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-runBtn{background:linear-gradient(135deg,#5c7cfa,#7950f2)}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="1"]{background:#6378dc38;color:#bac8ff}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="2"]{background:#6378dc52;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="3"]{background:#4c6ef5;color:#fff}
body[data-ds-dark-theme] .lkb-signalTag{background:#6378dc38;color:#dbe4ff}
/* ---- loading affordance ---- */
.lkb-spinner{flex:none;width:12px;height:12px;border:2px solid #dbe4ff;border-top-color:#4c6ef5;border-radius:50%;display:inline-block;animation:lkb-spin .7s linear infinite}
@keyframes lkb-spin{to{transform:rotate(360deg)}}
.lkb-loadbar{height:3px;border-radius:99px;background:#eef0f3;overflow:hidden;margin:6px 0 10px}
.lkb-loadbar::after{content:"";display:block;height:100%;width:38%;background:linear-gradient(90deg,#4c6ef5,#91a7ff);border-radius:99px;animation:lkb-slide 1.1s ease-in-out infinite}
@keyframes lkb-slide{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}
body[data-ds-dark-theme] .lkb-loadbar{background:#3a3a3c}
`;
		(function injectStyle() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dsh-leekbox-style") !== null) return;
			const style = document.createElement("style");
			style.id = "dsh-leekbox-style";
			style.textContent = CSS;
			document.head.appendChild(style);
		})();
		//#endregion

		//#region api + formatting
		const API = {
			indices: "/api/leekbox/indices",
			quote: "/api/leekbox/quote",
			kline: "/api/leekbox/kline",
			search: "/api/leekbox/search",
			rank: "/api/leekbox/rank",
			sector: "/api/leekbox/sector",
			sentiment: "/api/leekbox/sentiment",
			fflow: "/api/leekbox/fflow",
			longhu: "/api/leekbox/longhu",
			news: "/api/leekbox/news",
			watchlist: "/api/leekbox/watchlist",
			screener: "/api/leekbox/screener",
		};

		async function api(path, opts = {}) {
			const response = await fetch(path, {
				method: opts.method ?? "GET",
				headers: opts.body === void 0 ? void 0 : { "content-type": "application/json" },
				body: opts.body === void 0 ? void 0 : JSON.stringify(opts.body),
			});
			let data;
			try {
				data = await response.json();
			} catch {
				data = void 0;
			}
			if (!response.ok) {
				throw new Error(
					typeof data === "object" && data !== null && typeof data.error === "string"
						? data.error
						: `HTTP ${response.status}`
				);
			}
			return data;
		}

		function fmt(n, digits = 2) {
			return n === null || n === void 0 || !Number.isFinite(n) ? "—" : Number(n).toFixed(digits);
		}
		function fmtPct(n) {
			if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
			return (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
		}
		function fmtSign(n, digits = 2) {
			if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
			return (n > 0 ? "+" : "") + Number(n).toFixed(digits);
		}
		/** Format an amount given in YUAN into 亿/万 shorthand. */
		function fmtAmount(n) {
			if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
			const abs = Math.abs(n);
			if (abs >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (abs >= 1e4) return (n / 1e4).toFixed(2) + "万";
			return String(Math.round(n));
		}
		function trend(n) {
			return n > 0 ? "lkb-up" : n < 0 ? "lkb-down" : "";
		}
		function cnMarket(market) {
			if (market === "SH") return "沪";
			if (market === "SZ") return "深";
			if (market === "BJ") return "北";
			return market ?? "";
		}
		/** Client-side mirror of the server's normalizeCode (dedupe popup windows by one canonical code). */
		function normCode(raw) {
			let c = String(raw ?? "").trim().toLowerCase();
			if (/^(sh|sz|bj)\d{5,6}$/.test(c)) return c;
			const d = c.replace(/\D/g, "");
			if (!/^\d{5,6}$/.test(d)) return c;
			if (d.startsWith("11")) return "sh" + d;
			// 92xxxx → 北交所（须在 9 规则前判断，避免被并入沪市）
			if (/^92/.test(d)) return "bj" + d;
			if (/^[569]/.test(d)) return "sh" + d;
			if (/^[48]/.test(d)) return "bj" + d;
			return "sz" + d;
		}
		/**
		 * Watchlist membership probe. The watchlist stores normalized codes
		 * ("sh603626") while UI rows often carry bare codes ("603626") — compare
		 * through normCode on both sides or stars never light up.
		 */
		function isWatched(watchSet, code) {
			return watchSet.has(normCode(code));
		}
		/**
		 * In-panel confirm dialog service. `window.confirm` is a synchronous
		 * native modal that steals window focus and (in this embedded webview)
		 * can leave the renderer's mouse state stuck after dismissal — the
		 * search input becomes unclickable until the window is minimized and
		 * restored. `lkbConfirm` keeps the Promise<boolean> contract but
		 * resolves through ConfirmDialog rendered by the panel: zero native
		 * dialogs, no focus theft. A second confirm while one is open
		 * auto-cancels (no dialog stacking).
		 */
		let confirmState = null;
		const confirmListeners = new Set();
		function lkbConfirm(text) {
			if (confirmState !== null) return Promise.resolve(false);
			return new Promise((resolve) => {
				confirmState = { text, resolve };
				confirmListeners.forEach((fn) => fn(confirmState));
			});
		}
		function closeConfirm(ok) {
			if (confirmState === null) return;
			const current = confirmState;
			confirmState = null;
			confirmListeners.forEach((fn) => fn(null));
			current.resolve(ok);
		}
		function ConfirmDialog({ text }) {
			// Capture-phase Escape: dismiss the dialog before the panel's own
			// Escape chain (popup → panel) can react; Enter confirms.
			useEffect(() => {
				const onKey = (e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						e.preventDefault();
						closeConfirm(false);
					} else if (e.key === "Enter") {
						e.stopPropagation();
						e.preventDefault();
						closeConfirm(true);
					}
				};
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, []);
			return h(
				"div",
				{
					className: "lkb_confirmMask",
					onMouseDown: (e) => e.stopPropagation(),
					onClick: (e) => {
						if (e.target !== e.currentTarget) return;
						closeConfirm(false);
					},
				},
				h(
					"div",
					{ className: "lkb_confirmBox" },
					h("div", { className: "lkb_confirmText" }, text),
					h(
						"div",
						{ className: "lkb_confirmBtns" },
						h("button", { className: "lkb-btnGhost", onClick: () => closeConfirm(false) }, "取消"),
						h("button", { className: "lkb-btn", onClick: () => closeConfirm(true) }, "确定")
					)
				)
			);
		}
		/**
		 * Row-level click guard: let interactive children (select / button /
		 * input / anchor) handle their own clicks instead of bubbling into the
		 * row's open-detail handler.
		 */
		function openOnRow(e, onOpen, code, name) {
			if (e?.target?.closest?.("select,button,input,a")) return;
			onOpen(code, name);
		}
		/** Format a volume given in 手 (lots) into 万手/亿手 shorthand. */
		function fmtVol(lots) {
			if (lots === null || lots === void 0 || !Number.isFinite(lots)) return "—";
			const abs = Math.abs(lots);
			if (abs >= 1e8) return (lots / 1e8).toFixed(2) + "亿手";
			if (abs >= 1e4) return Number((lots / 1e4).toFixed(2)) + "万手";
			return String(Math.round(lots)) + "手";
		}
		/** "20250106143005" -> "01-06 14:30:05"; passes through anything else. */
		function fmtTime(s) {
			const t = String(s ?? "");
			return /^\d{14}$/.test(t) ? `${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}` : t;
		}
		function useInterval(fn, ms, deps = []) {
			const ref = useRef(fn);
			ref.current = fn;
			useEffect(() => {
				if (ms === null) return;
				const timer = setInterval(() => {
					try {
						ref.current();
					} catch {}
				}, ms);
				return () => clearInterval(timer);
			}, [ms, ...deps]);
		}
		/**
		 * 行情数据专用轮询:只在 A 股连续交易时段(周一~周五 9:30–11:30 / 13:00–15:00)
		 * 按周期触发;其余时间上游行情不再变化,挂载时的首次拉取即为终值,不再重复请求。
		 * 定时器保持空转但不发请求,以便跨开盘边界使用时(如 09:15 打开面板)在 09:30 自动进入轮询。
		 */
		function useTradingInterval(fn, ms, deps = []) {
			const ref = useRef(fn);
			ref.current = fn;
			useEffect(() => {
				if (ms === null) return;
				const timer = setInterval(() => {
					if (!marketOpenLabel().open) return;
					try {
						ref.current();
					} catch {}
				}, ms);
				return () => clearInterval(timer);
			}, [ms, ...deps]);
		}
		function marketOpenLabel() {
			const now = new Date();
			const day = now.getDay();
			const minutes = now.getHours() * 60 + now.getMinutes();
			const trading =
				day >= 1 &&
				day <= 5 &&
				((minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60));
			return { open: trading, label: trading ? "交易中" : day >= 1 && day <= 5 ? "已收盘" : "休市" };
		}
		function nowTime() {
			const d = new Date();
			const p = (x) => String(x).padStart(2, "0");
			return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
		}
		//#endregion

		//#region shared bits
		function StarButton({ code, name, on, confirmText }) {
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
		//#endregion

		//#region SentimentCard (大盘 · 市场情绪)
		/** 情绪分档:按 min 从高到低命中。fg 用于数字/指针,bg 为胶囊底色。 */
		const SENTI_TIERS = [
			{ min: 80, label: "沸腾", icon: "🌋", fg: "#e03131", desc: "赚钱效应极致,情绪高潮后警惕退潮" },
			{ min: 60, label: "偏热", icon: "🔥", fg: "#e8681a", desc: "做多氛围偏强,短线情绪活跃" },
			{ min: 40, label: "中性", icon: "😐", fg: "#d9a406", desc: "多空均衡,资金观望" },
			{ min: 20, label: "低迷", icon: "🌧️", fg: "#7cb342", desc: "亏钱效应显现,谨慎追高" },
			{ min: 0, label: "冰点", icon: "❄️", fg: "#0f9d6e", desc: "情绪冰点,往往孕育反转" },
		];
		/** 分档查询。 */
		function sentiTier(score) {
			return SENTI_TIERS.find((t) => score >= t.min) ?? SENTI_TIERS[SENTI_TIERS.length - 1];
		}
		/** v 从 [lo,hi] 线性映射到 0~100 并夹紧。 */
		const thermoMap = (v, lo, hi) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
		/**
		 * 综合情绪温度 0~100°:
		 * 市场宽度(上涨占比) 40% + 涨停强度(家数) 25% + 封板率 20% + 连板高度 15%;
		 * 单路数据缺失时按剩余权重归一,全部缺失返回 null。
		 */
		function sentiScore(s) {
			if (s === null || s === void 0 || typeof s !== "object") return null;
			const num = (v) => {
				const n = Number(v);
				return v === null || v === void 0 || v === "" || !Number.isFinite(n) ? null : n;
			};
			const up = num(s.up);
			const down = num(s.down);
			const limitUp = num(s.limitUp);
			const broken = num(s.broken);
			const maxBoard = num(s.maxBoard);
			const parts = [];
			if (up !== null && down !== null && up + down > 0) parts.push([thermoMap(up / (up + down), 0.3, 0.7), 0.4]);
			if (limitUp !== null) parts.push([thermoMap(limitUp, 10, 110), 0.25]);
			if (limitUp !== null && broken !== null && limitUp + broken > 0) parts.push([thermoMap(limitUp / (limitUp + broken), 0.35, 0.9), 0.2]);
			if (maxBoard !== null && maxBoard > 0) parts.push([thermoMap(maxBoard, 1, 8), 0.15]);
			if (parts.length === 0) return null;
			const w = parts.reduce((acc, p) => acc + p[1], 0);
			return Math.round(parts.reduce((acc, p) => acc + p[0] * p[1], 0) / w);
		}

		/** 大盘页市场情绪卡:左侧半圆分段温度仪表(当前档位高亮+游标点) + 右侧无框数据行。 */
		function SentimentCard() {
			const [senti, setSenti] = useState(null);
			const load = useCallback(() => {
				api(API.sentiment)
					.then((d) => {
						setSenti(d);
						try {
							localStorage.setItem("leekbox.sentiment", JSON.stringify(d));
						} catch {}
					})
					.catch(() => {});
			}, []);
			useEffect(() => {
				// 即写即显:复用行情页写入的 localStorage 缓存先渲染,再后台刷新覆盖
				try {
					const raw = localStorage.getItem("leekbox.sentiment");
					if (raw !== null) {
						const cached = JSON.parse(raw);
						if (cached && typeof cached === "object") setSenti(cached);
					}
				} catch {}
				load();
			}, [load]);
			useTradingInterval(load, 60000);
			const num = (v) => (v === null || v === void 0 || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
			const up = num(senti?.up);
			const down = num(senti?.down);
			const limitUp = num(senti?.limitUp);
			const limitDown = num(senti?.limitDown);
			const broken = num(senti?.broken);
			const maxBoard = num(senti?.maxBoard);
			const sealRate = limitUp !== null && broken !== null && limitUp + broken > 0 ? Math.round((limitUp / (limitUp + broken)) * 100) : null;
			const score = sentiScore(senti);
			const tier = score === null ? null : sentiTier(score);
			const tierVars = tier === null ? null : { "--lkb-tier-fg": tier.fg, "--lkb-tier-bg": tier.fg + "14" };
			const dash = "—";
			// —— 半圆分段仪表:viewBox 0 0 200 112,圆心(100,94) 半径 74,五档各占 36°,段间留 1.6° 缺口
			const GX = 100;
			const GY = 94;
			const GR = 74;
			const segPath = (i) => {
				const a0 = ((180 - i * 36 + 1.6) * Math.PI) / 180;
				const a1 = ((180 - (i + 1) * 36 - 1.6) * Math.PI) / 180;
				const x0 = (GX + GR * Math.cos(a0)).toFixed(2);
				const y0 = (GY - GR * Math.sin(a0)).toFixed(2);
				const x1 = (GX + GR * Math.cos(a1)).toFixed(2);
				const y1 = (GY - GR * Math.sin(a1)).toFixed(2);
				return `M ${x0} ${y0} A ${GR} ${GR} 0 0 1 ${x1} ${y1}`;
			};
			// SENTI_TIERS 按分值降序(0=沸腾);仪表段 0..4 = 冰点→沸腾,颜色取反序
			const activeSeg = score === null ? -1 : score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
			const fmtInt = (v) => (v === null ? dash : Number(v).toLocaleString("en-US"));
			const pairValue = (a, b, clsA, clsB) =>
				h(
					"span",
					{ className: "lkb-tValue" },
					h("b", { className: a !== null ? clsA : "" }, fmtInt(a)),
					h("i", null, "/"),
					h("b", { className: b !== null ? clsB : "" }, fmtInt(b))
				);
			const breadthBar = up !== null && down !== null && up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : void 0;
			const cell = (label, valueNode, opts = {}) =>
				h(
					"div",
					{ className: "lkb-tStat", title: opts.title ?? label },
					h("span", { className: "lkb-tLabel" }, label),
					valueNode,
					opts.bar === void 0 ? null : h("div", { className: "lkb-tBar" }, h("div", { className: "lkb-tBarUp", style: { width: opts.bar + "%" } }))
				);
			return h(
				"div",
				null,
				h(
					"div",
					{ className: "lkb-thermo", style: tierVars },
					h(
						"div",
						{ className: "lkb-gauge" },
						h(
							"svg",
							{ viewBox: "0 0 200 112", style: { width: 196, display: "block" } },
							[0, 1, 2, 3, 4].map((i) =>
								h("path", {
									key: "seg" + i,
									d: segPath(i),
									fill: "none",
									stroke: SENTI_TIERS[4 - i].fg,
									strokeWidth: activeSeg === i ? 11 : 8,
									opacity: score === null ? 0.28 : activeSeg === i ? 1 : 0.26,
									strokeLinecap: "butt",
									style: { transition: "opacity .3s, stroke-width .3s" },
								})
							),
							h(
								"g",
								{
									style: {
										transform: `rotate(${(score ?? 0) * 1.8}deg)`,
										transformOrigin: `${GX}px ${GY}px`,
										transition: "transform .8s cubic-bezier(.22,1,.36,1), opacity .3s",
										opacity: score === null ? 0 : 1,
									},
								},
								h("circle", { cx: GX - GR, cy: GY, r: 5.5, fill: tier !== null ? tier.fg : "#adb5bd", stroke: "var(--dsw-alias-bg-base,#fff)", strokeWidth: 2 })
							),
							h("text", { x: GX - GR, y: GY + 13, textAnchor: "middle", fontSize: 8.5, fill: "var(--dsw-alias-label-tertiary,#a2a7b3)" }, "0"),
							h("text", { x: GX + GR, y: GY + 13, textAnchor: "middle", fontSize: 8.5, fill: "var(--dsw-alias-label-tertiary,#a2a7b3)" }, "100")
						),
						h(
							"div",
							{ className: "lkb-gaugeScore" },
							h("span", { className: "lkb-gaugeVal" }, score === null ? dash : score + "°"),
							tier === null
								? h("span", { className: "lkb-gaugeTier" }, "数据获取中…")
								: h("span", { className: "lkb-gaugeTier", title: tier.desc }, tier.icon + " " + tier.label)
						)
					),
					h(
						"div",
						{ className: "lkb-thermoStats" },
						cell(
							"上涨 / 下跌",
							pairValue(up, down, "lkb-up", "lkb-down"),
							{ bar: breadthBar, title: `上涨 ${up ?? dash} 家 / 下跌 ${down ?? dash} 家` }
						),
						cell("涨停 / 跌停", pairValue(limitUp, limitDown, "lkb-up", "lkb-down"), { title: `涨停 ${limitUp ?? dash} 家 / 跌停 ${limitDown ?? dash} 家` }),
						cell("炸板", h("span", { className: "lkb-tValue" }, fmtInt(broken)), { title: "炸板:曾触及涨停后回落的家数" }),
						cell(
							"封板率",
							h("span", { className: "lkb-tValue" }, h("b", { className: sealRate === null ? "" : sealRate >= 70 ? "lkb-up" : sealRate < 50 ? "lkb-down" : "" }, sealRate === null ? dash : sealRate + "%")),
							{ title: "封板率 = 涨停 / (涨停 + 炸板)" }
						),
						cell("最高板", h("span", { className: "lkb-tValue" }, maxBoard !== null && maxBoard > 0 ? maxBoard + "板" : dash), { title: "当日最高连板数" })
					)
				)
			);
		}
		//#endregion

		//#region IndicesTab
		function IndicesTab({ onOpen }) {
			const [indices, setIndices] = useState([]);
			const [error, setError] = useState("");
			const [ts, setTs] = useState("");
			const load = useCallback(() => {
				api(API.indices)
					.then((data) => {
						setIndices(data.indices ?? []);
						setTs(nowTime());
						setError("");
					})
					.catch((e) => setError(e.message));
			}, []);
			useEffect(() => {
				load();
			}, [load]);
			useTradingInterval(load, 30000);
			const mkt = marketOpenLabel();
			return h(
				"div",
				null,
				h("div", { className: "lkb-status" }, h("span", null, `更新于 ${ts}`), h("span", null, mkt.label)),
				error === "" ? null : h("div", { className: "lkb-error" }, error),
				h(
					"div",
					{ className: "lkb-grid" },
					indices.map((q) => {
						const dir = q.change > 0 ? "up" : q.change < 0 ? "down" : "flat";
						const dirColor = dir === "up" ? "#e03131" : dir === "down" ? "#0f9d6e" : "#ced4da";
						const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
						return h(
							"div",
							{ className: "lkb-indexCard", key: q.code, style: { "--lkb-dir": dirColor }, onClick: (e) => openOnRow(e, onOpen, q.code, q.name) },
							h(
								"div",
								{ className: "lkb-indexName" },
								q.name,
								h("span", { className: "lkb-tag" }, cnMarket(q.market) + q.code.slice(2))
							),
							h("div", { className: "lkb-indexValue " + trend(q.change) }, fmt(q.price)),
							h(
								"div",
								{ className: "lkb-indexChange " + trend(q.change) },
								h("span", { className: "lkb-indexArrow" }, arrow),
								fmtPct(q.changePct),
								h("span", { className: "lkb-code", style: { marginLeft: 2 } }, fmtSign(q.change))
							),
							h(
								"div",
								{ className: "lkb-indexMeta" },
								h("span", null, `高 ${fmt(q.high)}`),
								h("span", null, `低 ${fmt(q.low)}`),
								h("span", null, `振幅 ${fmt(q.amplitude)}%`)
							)
						);
					})
				),
				h("div", { className: "lkb-status", style: { marginTop: 10 } }, "点击指数卡片可弹出详情窗口（K线 · 前复权）"),
				h(SentimentCard, null)
			);
		}
		//#endregion

		//#region MarketTab
		const RANK_CHOICES = [
			{ key: "changepercent", label: "涨幅榜", order: "desc" },
			{ key: "changepercent", label: "跌幅榜", order: "asc" },
			{ key: "amount", label: "成交额榜", order: "desc" },
			{ key: "turnoverratio", label: "换手率榜", order: "desc" },
			{ key: "netflow", label: "主力净流入", order: "desc" },
		];
		const BOARD_MODES = [
			{ key: "stocks", label: "📈 股票榜" },
			{ key: "sector", label: "🗂 板块榜" },
			{ key: "longhu", label: "🐉 龙虎榜" },
		];
		const POOL_CHOICES = [
			{ key: "hs_a", label: "沪深A股" },
			{ key: "main", label: "主板" },
			{ key: "non_main", label: "非主板" },
			{ key: "etf", label: "ETF/场内基金" },
			{ key: "cb", label: "可转债" },
			{ key: "lof", label: "LOF" },
		];

		/** 元 → 亿字符串（资金流向展示用）。 */
		const fmtYi = (v) => {
			if (v === null || v === void 0 || !Number.isFinite(v)) return "—";
			const yi = v / 1e8;
			const sign = yi > 0 ? "+" : "";
			return sign + yi.toFixed(yi >= 100 ? 0 : yi >= 10 ? 1 : 2) + "亿";
		};

		const SEARCH_TYPE_META = {
			stock: { label: "股票", cls: "t-stock" },
			etf: { label: "ETF", cls: "t-etf" },
			cb: { label: "转债", cls: "t-cb" },
			lof: { label: "LOF", cls: "t-lof" },
			fund: { label: "基金", cls: "t-lof" },
		};

		/**
		 * Redesigned search results: a dropdown under the search box with type
		 * badges, live quote chips (price + change %) and star actions — instead
		 * of the old plain name/code rows.
		 */
		function SearchResultsCard({ hits, loading, error, source, kw, watchSet, onOpen, onClear }) {
			return h(
				"div",
				{
					className: "lkb-srCard",
					// Keep focus in the input on mousedown: if focus left now, the
					// onBlur-close would unmount the card before the click lands.
					onMouseDown: (e) => e.preventDefault(),
				},
				h(
					"div",
					{ className: "lkb-srMeta" },
					h("span", { className: "lkb-srQuery" }, "“", kw, "”"),
					loading
						? h("span", { className: "lkb-srNote" }, h("span", { className: "lkb-spinner" }), " 搜索中…")
						: hits.length > 0
							? h("span", { className: "lkb-srNote" }, `${hits.length} 个结果`, source === "smartbox" ? " · 拼音匹配" : "")
							: h("span", { className: "lkb-srNote" }, error ? "搜索失败，请重试" : "无匹配结果"),
					hits.length > 0 && !loading
						? h("span", { style: { marginLeft: "auto" } }, h("button", { className: "lkb-srClear", onClick: onClear }, "清空"))
						: null
				),
				loading && hits.length === 0
					? h("div", { className: "lkb-srSkeletons" }, Array.from({ length: 5 }, (_, i) => h("div", { key: i, className: "lkb-srSkeleton" })))
					: null,
				!loading && error
					? h("div", { className: "lkb-srEmpty" }, "⚠ 搜索服务暂时不可用，稍后再试")
					: null,
				!loading && !error && hits.length === 0
					? h("div", { className: "lkb-srEmpty" }, "没有找到匹配的股票 / ETF / 可转债。试试代码、名称关键字或拼音首字母（如 gzmt）")
					: null,
				hits.length > 0
					? h(
							"div",
							{ className: "lkb-srList" },
							hits.map((s) => {
								const tm = SEARCH_TYPE_META[s.type] ?? SEARCH_TYPE_META.fund;
								const up = s.changePct !== null && s.changePct !== void 0 && Number.isFinite(Number(s.changePct)) ? trend(Number(s.changePct)) : "";
								return h(
									"div",
									{
										key: s.quoteId || s.code,
										className: "lkb-srItem",
										onClick: (e) => openOnRow(e, onOpen, s.code, s.name),
									},
									h("span", { className: "lkb-srBadge " + tm.cls }, tm.label),
									h(
										"span",
										{ className: "lkb-srId" },
										h("span", { className: "lkb-name" }, s.name),
										h("span", { className: "lkb-code" }, cnMarket(s.market) + " " + s.code)
									),
									h(
										"span",
										{ className: "lkb-srQuote " + up },
										// No quote data (server cold-start / feed miss): show
										// nothing rather than "— —" placeholder dashes.
										s.price === null || s.price === void 0
											? null
											: h("span", { className: "lkb-srPrice" }, fmt(s.price)),
										s.changePct === null || s.changePct === void 0 || !Number.isFinite(Number(s.changePct))
											? null
											: h("span", { className: "lkb-srPct" }, fmtPct(s.changePct))
									),
									h("span", { className: "lkb-srStar" }, h(StarButton, { code: s.code, name: s.name, on: isWatched(watchSet, s.code), confirmText: `确定将 ${s.name}（${s.code}）移出自选吗？` }))
								);
							})
						)
					: null
			);
		}

		function MarketTab({ onOpen, watchCodes }) {
			const [kw, setKw] = useState("");
			const [hits, setHits] = useState([]);
			const [searchOpen, setSearchOpen] = useState(false);
			const [searchLoading, setSearchLoading] = useState(false);
			const [searchSource, setSearchSource] = useState("");
			const [searchError, setSearchError] = useState(false);
			const [rankKey, setRankKey] = useState(0);
			const [page, setPage] = useState(1);
			const [pageSize, setPageSize] = useState(30);
			const [total, setTotal] = useState(0);
			const [rows, setRows] = useState([]);
			const [loading, setLoading] = useState(false);
			const [error, setError] = useState("");
			const [mode, setMode] = useState("stocks"); // stocks | sector | longhu
			const [pool, setPool] = useState("hs_a"); // hs_a | etf | cb | lof
			const [showZt, setShowZt] = useState(false);
			const [ztBoard, setZtBoard] = useState(null); // null=全部 | 板数=只看该连板
			const [sectorType, setSectorType] = useState("industry"); // industry | concept
			const [sectorSort, setSectorSort] = useState("f3"); // f3 涨跌幅 | f62 主力净流入
			const [sectorRows, setSectorRows] = useState([]);
			const [sectorTotal, setSectorTotal] = useState(0);
			const [sectorLoading, setSectorLoading] = useState(false);
			const [lhRows, setLhRows] = useState([]);
			const [lhTotal, setLhTotal] = useState(0);
			const [lhDate, setLhDate] = useState("");
			const [lhLoading, setLhLoading] = useState(false);
			const [sentiment, setSentiment] = useState(null);
			const debounceRef = useRef(null);
			const searchSeq = useRef(0);
			const loadSeq = useRef(0);
			const watchSet = new Set(watchCodes ?? []);
			useEffect(() => {
				clearTimeout(debounceRef.current);
				const k = kw.trim();
				if (k === "") {
					setHits([]);
					setSearchLoading(false);
					setSearchError(false);
					return;
				}
				const seq = ++searchSeq.current;
				setSearchLoading(true);
				setSearchError(false);
				debounceRef.current = setTimeout(() => {
					api(API.search + `?kw=${encodeURIComponent(k)}&count=20`)
						.then((data) => {
							if (seq !== searchSeq.current) return;
							setHits(data.hits ?? []);
							setSearchSource(data.source ?? "");
						})
						.catch(() => {
							if (seq !== searchSeq.current) return;
							setHits([]);
							setSearchError(true);
						})
						.finally(() => {
							if (seq !== searchSeq.current) return;
							setSearchLoading(false);
						});
				}, 120);
				return () => clearTimeout(debounceRef.current);
			}, [kw]);
			const loadRank = useCallback(() => {
				const seq = ++loadSeq.current;
				const choice = RANK_CHOICES[rankKey];
				setLoading(true);
				api(API.rank + `?sort=${choice.key}&order=${choice.order}&page=${page}&size=${pageSize}&node=${pool}`)
					.then((data) => {
						if (seq !== loadSeq.current) return; // stale response
						setRows(data.rows ?? []);
						setTotal(data.total ?? 0);
						setError("");
					})
					.catch((e) => {
						if (seq !== loadSeq.current) return;
						setError(e.message);
					})
					.finally(() => {
						if (seq !== loadSeq.current) return;
						setLoading(false);
					});
			}, [rankKey, page, pageSize, pool]);
			useEffect(() => {
				loadRank();
			}, [loadRank]);
			const loadSector = useCallback(() => {
				setSectorLoading(true);
				api(API.sector + `?type=${sectorType}&sort=${sectorSort}&order=desc&page=1&size=30`)
					.then((data) => {
						setSectorRows(data.rows ?? []);
						setSectorTotal(data.total ?? 0);
					})
					.catch((e) => setError(e.message))
					.finally(() => setSectorLoading(false));
			}, [sectorType, sectorSort]);
			useEffect(() => {
				if (mode === "sector") loadSector();
			}, [mode, loadSector]);
			const loadLonghu = useCallback(() => {
				setLhLoading(true);
				api(API.longhu + `?date=&page=1&size=30`)
					.then((data) => {
						setLhRows(data.rows ?? []);
						setLhTotal(data.total ?? 0);
						setLhDate(data.date ?? "");
					})
					.catch((e) => setError(e.message))
					.finally(() => setLhLoading(false));
			}, []);
			useEffect(() => {
				if (mode === "longhu") loadLonghu();
			}, [mode, loadLonghu]);
			const loadSentiment = useCallback(() => {
				api(API.sentiment)
					.then((d) => {
						setSentiment(d);
						try {
							localStorage.setItem("leekbox.sentiment", JSON.stringify(d));
						} catch {}
					})
					.catch(() => {});
			}, []);
			useEffect(() => {
				// 即写即显:情绪数据上游冷启动可能要几秒,先用上次会话的缓存渲染,
				// 再立即后台刷新覆盖,避免长时间空转显示 "—"
				try {
					const raw = localStorage.getItem("leekbox.sentiment");
					if (raw !== null) {
						const cached = JSON.parse(raw);
						if (cached && typeof cached === "object") setSentiment(cached);
					}
				} catch {}
				loadSentiment();
			}, [loadSentiment]);
			useTradingInterval(() => {
				loadRank();
				loadSentiment();
			}, 60000);
			return h(
				"div",
				null,
				h(
					"div",
					{ className: "lkb-stickyTop" },
					h(
						"div",
						{ className: "lkb-searchWrap" },
						h("div", { className: "lkb-searchRow" },
							h("span", { className: "lkb-searchGlass" }, "🔍"),
							h("input", { className: "lkb-input lkb-searchInput", placeholder: "搜索股票/ETF/转债：代码、名称或拼音首字母，如 600519、茅台、gzmt、510300", value: kw, onChange: (e) => { setKw(e.target.value); setSearchOpen(true); }, onFocus: () => { if (kw.trim() !== "") setSearchOpen(true); }, onKeyDown: (e) => { if (e.key === "Escape") { e.stopPropagation(); if (kw !== "") { setKw(""); } else { setSearchOpen(false); e.target.blur(); } } else if (e.key === "Enter" && hits.length > 0) { setSearchOpen(false); onOpen(hits[0].code, hits[0].name); } }, onBlur: (e) => { const wrap = e.currentTarget.closest(".lkb-searchWrap"); if (wrap === null || !wrap.contains(e.relatedTarget)) setSearchOpen(false); } }),
							kw !== "" ? h("button", { className: "lkb-searchClear", title: "清空", onClick: () => setKw("") }, "✕") : null
						),
						searchOpen && kw.trim() !== ""
							? h(SearchResultsCard, {
									hits,
									loading: searchLoading,
									error: searchError,
									source: searchSource,
									kw: kw.trim(),
									watchSet,
									onOpen: (code, name) => {
										setSearchOpen(false);
										onOpen(code, name);
									},
									onClear: () => setKw(""),
								})
							: null
					),
				h(
					"div",
					{ className: "lkb-headRow" },
					h(
						"div",
						{ className: "lkb-seg" },
						BOARD_MODES.map((m) => h("button", { key: m.key, className: "lkb-segBtn", "data-active": mode === m.key ? "true" : "false", onClick: () => setMode(m.key) }, m.label))
					)
				),
				sentiment !== null && sentiment.maxBoard > 0
					? h(
							"div",
							{ className: "lkb-chipRow", style: { marginTop: 6 } },
							h("span", { className: "lkb-chipLabel" }, "连板梯队"),
							(sentiment.ladder ?? []).map((l) =>
								h(
									"button",
									{
										key: l.board,
										className: "lkb-chip",
										"data-active": showZt && ztBoard === l.board ? "true" : "false",
										title: `点击查看 ${l.board} 连板的 ${l.count} 只个股`,
										onClick: () => {
											if (showZt && ztBoard === l.board) {
												setShowZt(false);
												setZtBoard(null);
											} else {
												setZtBoard(l.board);
												setShowZt(true);
											}
										},
									},
									l.board + "板",
									h("b", { className: "lkb-up", style: { marginLeft: 3 } }, l.count)
								)
							),
							h("button", { className: "lkb-chip", "data-active": showZt && ztBoard === null ? "true" : "false", onClick: () => { setZtBoard(null); setShowZt(!showZt); } }, showZt ? "收起涨停池 ▲" : "全部涨停池 ▼")
						)
					: null,
				showZt && (sentiment?.ztList ?? []).length > 0
					? h(
							"div",
							{ className: "lkb-chartBox", style: { padding: 6, marginTop: 6, maxHeight: 240, overflowY: "auto" } },
							h(
								"div",
								{ className: "lkb-status", style: { padding: "2px 8px 6px" } },
								ztBoard === null
									? `全部涨停（${sentiment.ztList.length} 只）`
									: `${ztBoard} 连板（${(sentiment.ztList ?? []).filter((s) => s.board === ztBoard).length} 只）`
							),
							(sentiment.ztList ?? [])
								.filter((s) => ztBoard === null || s.board === ztBoard)
								.map((s) =>
								h(
									"div",
									{
										key: s.code,
										style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8, cursor: "pointer" },
										onClick: (e) => openOnRow(e, onOpen, s.code, s.name),
									},
									h("span", { className: "lkb-name" }, s.name),
									h("span", { className: "lkb-code" }, s.code),
									h("span", { className: "lkb-pill", style: { padding: "1px 8px", fontSize: 10 } }, s.board + "板"),
									h("span", { className: "lkb-code", style: { marginLeft: "auto" } }, s.industry ?? "")
								)
							)
						)
					: null,
				mode === "stocks"
					? h(
							"div",
							null,
							h(
								"div",
								{ className: "lkb-chipRow" },
								h("span", { className: "lkb-chipLabel" }, "市场"),
								POOL_CHOICES.map((p) => h("button", { key: p.key, className: "lkb-chip", "data-active": pool === p.key ? "true" : "false", onClick: () => { setPool(p.key); setPage(1); } }, p.label))
							),
							h("div", { className: "lkb-chipRow" }, h("span", { className: "lkb-chipLabel" }, "榜单"), RANK_CHOICES.map((c, i) => h("button", { key: c.label, className: "lkb-chip", "data-active": rankKey === i ? "true" : "false", onClick: () => { setRankKey(i); setPage(1); } }, c.label)))
						)
					: mode === "sector"
						? h(
								"div",
								{ className: "lkb-chipRow" },
								h("span", { className: "lkb-chipLabel" }, "板块"),
								h("button", { className: "lkb-chip", "data-active": sectorType === "industry" ? "true" : "false", onClick: () => setSectorType("industry") }, "行业"),
								h("button", { className: "lkb-chip", "data-active": sectorType === "concept" ? "true" : "false", onClick: () => setSectorType("concept") }, "概念"),
								h("span", { className: "lkb-chipLabel", style: { marginLeft: 8 } }, "排序"),
								h("button", { className: "lkb-chip", "data-active": sectorSort === "f3" ? "true" : "false", onClick: () => setSectorSort("f3") }, "涨幅"),
								h("button", { className: "lkb-chip", "data-active": sectorSort === "f62" ? "true" : "false", onClick: () => setSectorSort("f62") }, "主力净流入")
							)
						: null,
				mode === "longhu" && lhDate !== ""
					? h(
							"div",
							{ className: "lkb-banner" },
							"📅 龙虎榜数据日期 ",
							h("b", null, lhDate),
							" · 上榜 ",
							h("b", null, lhTotal),
							" 只（收盘后晚间更新）"
						)
					: null,
				loading
					? h(
							"div",
							{ className: "lkb-status" },
							h("span", { className: "lkb-spinner" }),
							h("span", null, RANK_CHOICES[rankKey].label + " 请求中，请稍候…")
						)
					: null,
				loading ? h("div", { className: "lkb-loadbar" }) : null,
				error === "" ? null : h("div", { className: "lkb-error" }, error),
				),
				mode === "stocks"
					? h(
							"table",
							null,
							h(
								"thead",
								null,
								h(
									"tr",
									null,
									h("th", { style: { width: 34, textAlign: "left" } }, "#"),
									h("th", null, "名称"),
									h("th", null, "现价"),
									h("th", null, "涨跌幅"),
									h("th", null, "涨跌额"),
									h("th", null, "成交额"),
									h("th", null, "主力净流入"),
									h("th", null, "换手"),
									h("th", null, "市盈率"),
									h("th", null, "")
								)
							),
							h(
								"tbody",
								null,
								rows.map((r, i) =>
									h(
										"tr",
										{ key: r.symbol, style: { animationDelay: Math.min(i * 12, 240) + "ms" }, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
										h("td", null, h("span", { className: "lkb-rankNum", "data-medal": i < 3 ? String(i + 1) : void 0 }, String((page - 1) * pageSize + i + 1))),
										h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
										h("td", null, fmt(r.price)),
										h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
										h("td", { className: trend(r.change) }, fmtSign(r.change)),
										h("td", null, fmtAmount(r.amount)),
										h("td", { className: trend(r.netflow) }, fmtYi(r.netflow)),
										h("td", null, r.turnoverRate === null ? "—" : fmt(r.turnoverRate) + "%"),
										h("td", null, r.pe === null ? "—" : fmt(r.pe)),
										h("td", null, h(StarButton, { code: r.code, name: r.name, on: isWatched(watchSet, r.code), confirmText: `确定将 ${r.name}（${r.code}）移出自选吗？` }))
									)
								)
							)
						)
					: mode === "sector"
						? h(
								"table",
								null,
								h(
									"thead",
									null,
									h(
										"tr",
										null,
										h("th", null, "板块"),
										h("th", null, "涨跌幅"),
										h("th", null, "主力净流入"),
										h("th", null, "上涨/下跌"),
										h("th", null, "领涨股")
									)
								),
								h(
									"tbody",
									null,
									sectorLoading
										? h("tr", null, h("td", { colSpan: 5 }, "板块数据加载中…"))
										: sectorRows.map((r, i) =>
												h(
													"tr",
													{ key: r.code, style: { animationDelay: Math.min(i * 12, 240) + "ms" } },
													h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
													h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
													h("td", { className: trend(r.netInflow) }, fmtYi(r.netInflow)),
													h("td", null, h("span", { className: "lkb-up" }, r.upCount ?? "—"), " / ", h("span", { className: "lkb-down" }, r.downCount ?? "—")),
													h("td", null, r.leader === "" ? "—" : h("span", { className: "lkb-name" }, r.leader), r.leaderChangePct === null || r.leader === "" ? null : h("span", { className: "lkb-code" }, fmtPct(r.leaderChangePct)))
												)
											)
								)
							)
						: mode === "longhu"
							? h(
									"table",
									null,
									h(
										"thead",
										null,
										h(
											"tr",
											null,
											h("th", null, "名称"),
											h("th", null, "现价"),
											h("th", null, "涨跌幅"),
											h("th", null, "龙虎榜净买额"),
											h("th", null, "上榜原因")
										)
									),
									h(
										"tbody",
										null,
										lhLoading
											? h("tr", null, h("td", { colSpan: 5 }, "龙虎榜加载中…"))
											: lhRows.map((r, i) =>
													h(
														"tr",
														{ key: r.code + r.reason, style: { animationDelay: Math.min(i * 12, 240) + "ms" }, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
														h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
														h("td", null, fmt(r.close)),
														h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
														h("td", { className: trend(r.netAmt) }, fmtYi(r.netAmt)),
														h("td", { className: "lkb-code" }, r.reason)
													)
												)
									)
								)
							: null,
				mode === "stocks" && total > 0
					? h(
							"div",
							{ className: "lkb-pager", style: { flexWrap: "wrap" } },
							h("button", { className: "lkb-btnGhost", disabled: page <= 1 || loading, onClick: () => setPage(1) }, "« 首页"),
							h("button", { className: "lkb-btnGhost", disabled: page <= 1 || loading, onClick: () => setPage(page - 1) }, "‹ 上一页"),
							h("span", { className: "lkb-status", style: { alignSelf: "center" } }, `第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页 · 共 ${total} 只`),
							h("button", { className: "lkb-btnGhost", disabled: loading || page >= Math.ceil(total / pageSize), onClick: () => setPage(page + 1) }, "下一页 ›"),
							h("button", { className: "lkb-btnGhost", disabled: loading || page >= Math.ceil(total / pageSize), onClick: () => setPage(Math.max(1, Math.ceil(total / pageSize))) }, "末页 »"),
							h(
								"select",
								{ className: "lkb-input", style: { width: 92, padding: "5px 8px", fontSize: 12 }, value: String(pageSize), onChange: (e) => { setPageSize(Number(e.target.value)); setPage(1); } },
								h("option", { value: "30" }, "30 条/页"),
								h("option", { value: "50" }, "50 条/页"),
								h("option", { value: "100" }, "100 条/页")
							)
						)
					: mode === "sector" && sectorTotal > 0
						? h("div", { className: "lkb-pager" }, h("span", { className: "lkb-status" }, `共 ${sectorTotal} 个板块（按 ${sectorSort === "f62" ? "主力净流入" : "涨跌幅"} 排序）`))
						: null
			);
		}
		//#endregion

		//#region WatchlistTab
		/** Trigger a browser download for an in-memory blob. */
		function downloadBlob(name, blob) {
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		}

		function WatchlistTab({ onOpen, bump }) {
			const [items, setItems] = useState([]);
			const [quotes, setQuotes] = useState([]);
			const [group, setGroup] = useState("全部");
			const [error, setError] = useState("");
			const [ioMsg, setIoMsg] = useState("");
			const fileRef = useRef(null);
			const importMode = useRef("merge");
			const load = useCallback(() => {
				api(API.watchlist)
					.then(async (data) => {
						const list = data.watchlist ?? [];
						setItems(list);
						if (list.length === 0) return;
						const codes = list.map((e) => e.code).join(",");
						const q = await api(API.quote + `?codes=${codes}`);
						setQuotes(q.quotes ?? []);
						setError("");
					})
					.catch((e) => setError(e.message));
			}, []);
			useEffect(() => {
				load();
			}, [load, bump]);
			useTradingInterval(load, 15000);
			// Auto-clear the import/export status line.
			useEffect(() => {
				if (ioMsg === "") return;
				const timer = setTimeout(() => setIoMsg(""), 8000);
				return () => clearTimeout(timer);
			}, [ioMsg]);
			const dateStamp = () => {
				const d = new Date();
				return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
			};
			const doExport = (format) => {
				fetch(`${API.watchlist}/export?format=${format}`)
					.then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
					.then((blob) => {
						downloadBlob(`leekbox-watchlist-${dateStamp()}.${format}`, blob);
						setIoMsg(`已导出 ${items.length} 只（${format.toUpperCase()}）`);
					})
					.catch((e) => setIoMsg(`导出失败：${e.message}`));
			};
			const pickFile = (mode) => {
				const proceed =
					mode === "replace" && items.length > 0
						? lkbConfirm(`覆盖导入将清空现有 ${items.length} 只自选股，改用文件中的列表。确定继续吗？`)
						: Promise.resolve(true);
				proceed.then((ok) => {
					if (!ok) return;
					importMode.current = mode;
					fileRef.current?.click();
				});
			};
			const onImportFile = (e) => {
				const file = e.target.files?.[0];
				e.target.value = ""; // allow re-picking the same file later
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					api(`${API.watchlist}/import`, {
						method: "POST",
						body: { content: String(reader.result ?? ""), mode: importMode.current },
					})
						.then((d) => {
							const bad = (d.invalid ?? []).length;
							const base =
								d.mode === "replace"
									? `覆盖导入完成：${d.replaced ?? 0} 只`
									: `导入完成：新增 ${d.added ?? 0}，跳过重复 ${d.skipped ?? 0}`;
							setIoMsg(bad > 0 ? `${base}，无效 ${bad}` : base);
							load();
						})
						.catch((err) => setIoMsg(`导入失败：${err.message}`));
				};
				reader.onerror = () => setIoMsg("导入失败：文件读取失败");
				reader.readAsText(file, "utf8");
			};
			const groups = ["全部", ...Array.from(new Set(items.map((e) => e.group || "默认")))];
			const shown = group === "全部" ? items : items.filter((e) => (e.group || "默认") === group);
			const byCode = new Map(quotes.map((q) => [q.code, q]));
			const ioRow = h(
				"div",
				{ className: "lkb-chipRow", style: { justifyContent: "space-between", alignItems: "center" } },
				h(
					"div",
					{ style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
					h("button", { className: "lkb-chip", title: "从 JSON / CSV / TXT 导入，与现有自选合并（跳过重复）", onClick: () => pickFile("merge") }, "📥 导入"),
					h("button", { className: "lkb-chip", title: "用文件中的列表替换现有自选（会先确认）", onClick: () => pickFile("replace") }, "覆盖导入"),
					h("button", { className: "lkb-chip", title: "导出为 JSON 备份（含分组，可再次导入）", onClick: () => doExport("json") }, "导出 JSON"),
					h("button", { className: "lkb-chip", title: "导出为 CSV（Excel / WPS 可直接打开）", onClick: () => doExport("csv") }, "导出 CSV")
				),
				ioMsg === "" ? null : h("span", { className: "lkb-status" }, ioMsg)
			);
			const fileInput = h("input", {
				ref: fileRef,
				type: "file",
				accept: ".json,.csv,.txt,application/json,text/csv,text/plain",
				style: { display: "none" },
				onChange: onImportFile,
			});
			if (error !== "") return h("div", { className: "lkb-error" }, error);
			if (items.length === 0)
				return h(
					"div",
					null,
					ioRow,
					fileInput,
					h("div", { className: "lkb-empty" }, "自选股为空。去「行情」搜索或从榜单点击 ☆ 添加，也可以直接点击「导入」从文件恢复。")
				);
			return h(
				"div",
				null,
				ioRow,
				fileInput,
				h(
					"div",
					{ className: "lkb-chipRow" },
					groups.map((g) => h("button", { key: g, className: "lkb-chip", "data-active": group === g ? "true" : "false", onClick: () => setGroup(g) }, g, h("span", { className: "lkb-code", style: { marginLeft: 4 } }, g === "全部" ? items.length : items.filter((e) => (e.group || "默认") === g).length)))
				),
				h(
					"table",
					null,
					h(
						"thead",
						null,
						h(
							"tr",
							null,
							h("th", null, "名称"),
							h("th", null, "现价"),
							h("th", null, "涨跌幅"),
							h("th", null, "涨跌额"),
							h("th", null, "今开"),
							h("th", null, "最高/最低"),
							h("th", null, "成交额"),
							h("th", null, "换手"),
							h("th", null, "")
						)
					),
					h(
						"tbody",
						null,
						shown.map((it) => {
							const q = byCode.get(it.code);
							return h(
								"tr",
								{ key: it.code, onClick: (e) => openOnRow(e, onOpen, it.code, it.name) },
								h("td", null, h("span", { className: "lkb-name" }, q?.name || it.name), h("span", { className: "lkb-code" }, it.code)),
								h("td", { className: trend(q?.change) }, fmt(q?.price)),
								h("td", { className: trend(q?.change) }, fmtPct(q?.changePct)),
								h("td", { className: trend(q?.change) }, fmtSign(q?.change)),
								h("td", null, fmt(q?.open)),
								h("td", null, fmt(q?.high), " / ", fmt(q?.low)),
								h("td", null, q?.amount === null || q?.amount === void 0 ? "—" : fmtAmount((q.amount ?? 0) * 10000)),
								h("td", null, q?.turnoverRate === null || q?.turnoverRate === void 0 ? "—" : fmt(q?.turnoverRate) + "%"),
								h(
									"td",
									null,
									h(
										"select",
										{
											className: "lkb-input",
											style: { width: 76, padding: "3px 6px", fontSize: 11 },
											value: it.group || "默认",
											// Stop the click here so the row's open-detail handler never sees it.
											onClick: (e) => e.stopPropagation(),
											onChange: (e) => {
												const g = e.target.value;
												api(API.watchlist + "/add", { method: "POST", body: { code: it.code, group: g } })
													.then(() => {
														setItems((prev) => prev.map((x) => (x.code === it.code ? { ...x, group: g } : x)));
													})
													.catch(() => {});
											},
										},
										["默认", "短线", "长线", "观察"].map((g) => h("option", { key: g, value: g }, g))
									),
									h(StarButton, { code: it.code, name: it.name, on: true, confirmText: `确定将 ${it.name}（${it.code}）移出自选吗？` })
								)
							);
						})
					)
				)
			);
		}
		//#endregion

		//#region ScreenerTab
		const SCREEN_SIGNALS = [
			{ key: "macdGold", label: "MACD金叉(近3日)" },
			{ key: "macdZero", label: "MACD零轴上" },
			{ key: "kdjGold", label: "KDJ金叉" },
			{ key: "jOversold", label: "J值超卖(<20)" },
			{ key: "rsiGold", label: "RSI金叉" },
			{ key: "rsiOversold", label: "RSI超卖(<20)" },
			{ key: "maBullish", label: "均线多头排列" },
			{ key: "aboveMa20", label: "站上MA20" },
			{ key: "aboveMa60", label: "站上MA60" },
			{ key: "bollBreak", label: "突破布林上轨" },
			{ key: "volumeSurge", label: "放量(>1.5倍5日均量)" },
			{ key: "upStreak", label: "连涨≥3日" },
			{ key: "newHigh60", label: "创60日新高" },
		];
		const SIGNAL_LABEL = Object.fromEntries(SCREEN_SIGNALS.map((s) => [s.key, s.label]));
		const SCREEN_GROUPS = [
			{ key: "trend", label: "趋势动能", items: ["macdGold", "macdZero", "upStreak", "newHigh60"] },
			{ key: "osc", label: "超买超卖", items: ["kdjGold", "jOversold", "rsiGold", "rsiOversold"] },
			{ key: "ma", label: "均线 · 布林", items: ["maBullish", "aboveMa20", "aboveMa60", "bollBreak"] },
			{ key: "vol", label: "量能异动", items: ["volumeSurge"] },
		];
		/** Preset strategies for the multi-strategy intersection mode (mirror of the server). */
		const SCREEN_STRATEGIES = [
			{ key: "macdGold", label: "MACD金叉", desc: "MACD金叉买入信号" },
			{ key: "maBullish", label: "均线多头", desc: "5日>10日>20日均线多头排列" },
			{ key: "volBreak", label: "放量突破", desc: "放量突破布林上轨" },
			{ key: "oversold", label: "超卖反弹", desc: "J值或RSI超卖" },
			{ key: "trendUp", label: "趋势转强", desc: "MACD零轴上+站上MA20" },
			{ key: "newHigh", label: "创60日新高", desc: "创60日新高+站上MA60" },
			{ key: "strongRise", label: "强势连涨", desc: "连涨且均线多头" },
		];
		const STRATEGY_LABEL = Object.fromEntries(SCREEN_STRATEGIES.map((s) => [s.key, s.label]));
		const NODE_CHIPS = [
			{ v: "hs_a", label: "沪深A股" },
			{ v: "sh_a", label: "沪A" },
			{ v: "sz_a", label: "深A" },
			{ v: "cyb", label: "创业板" },
			{ v: "kcb", label: "科创板" },
		];
		const UNIVERSE_OPTS = [
			["300", "成交额前300"],
			["800", "成交额前800"],
			["1500", "成交额前1500"],
			["0", "全市场"],
		];

		function ScreenerTab({ onOpen, watchCodes }) {
			const [mode, setMode] = useState("standard"); // standard | multi
			const [node, setNode] = useState("hs_a");
			const [universe, setUniverse] = useState(800);
			const [f, setF] = useState({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
			const [excludeST, setExcludeST] = useState(true);
			const [require, setRequire] = useState({});
			const [strategies, setStrategies] = useState({});
			const [minHits, setMinHits] = useState(2);
			const [minScore, setMinScore] = useState("0");
			const [rows, setRows] = useState([]);
			const [running, setRunning] = useState(false);
			const [progress, setProgress] = useState(null);
			const [error, setError] = useState("");
			const [ran, setRan] = useState(false);
			const watchSet = new Set(watchCodes ?? []);
			const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
			const toggleReq = (key) => () => setRequire((prev) => ({ ...prev, [key]: !prev[key] }));
			const toggleStrat = (key) => () => setStrategies((prev) => ({ ...prev, [key]: !prev[key] }));
			const run = () => {
				if (running) return;
				setRunning(true);
				setRan(true);
				setError("");
				setRows([]);
				setProgress({ stage: "universe" });
				const params = {
					node,
					universe: Number(universe) || 0,
					excludeST,
					mode,
				};
				if (mode === "multi") {
					params.strategies = SCREEN_STRATEGIES.filter((s) => strategies[s.key]).map((s) => s.key);
					params.minStrategyHits = Math.max(1, Number(minHits) || 2);
				} else {
					params.minScore = Number(minScore) || 0;
					params.require = SCREEN_SIGNALS.filter((s) => require[s.key]).map((s) => s.key);
				}
				for (const [k, v] of Object.entries(f)) {
					if (v !== "") params[k] = Number(v);
				}
				const timer = setInterval(() => {
					api(API.screener + "/progress")
						.then((p) => setProgress(p))
						.catch(() => {});
				}, 600);
				api(API.screener, { method: "POST", body: params })
					.then((data) => {
						setRows(data.rows ?? []);
						setProgress({ stage: "done" });
					})
					.catch((e) => setError(e.message))
					.finally(() => {
						clearInterval(timer);
						setRunning(false);
					});
			};
			const stageText = (p) => {
				if (!p) return "";
				switch (p.stage) {
					case "universe":
						return `扫描股票池快照…（已获取 ${p.scanned ?? 0} 只）`;
					case "filter":
						return `基础条件过滤…（候选 ${p.candidates ?? 0} 只）`;
					case "kline":
						return `拉取K线计算指标 ${p.done ?? 0}/${p.total ?? 0}…`;
					case "indicators":
						return "计算技术指标评分…";
					case "done":
						return "完成";
					default:
						return "";
				}
			};
			const pct =
				progress && progress.total > 0
					? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100))
					: null;
			const selCount = mode === "multi" ? Object.values(strategies).filter(Boolean).length : Object.values(require).filter(Boolean).length;
			const resetAll = () => {
				setMode("standard");
				setNode("hs_a");
				setUniverse(800);
				setF({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
				setExcludeST(true);
				setRequire({});
				setStrategies({});
				setMinHits(2);
				setMinScore("0");
			};
			const rangeField = (label, lo, hi) =>
				h(
					"div",
					{ className: "lkb-condBlock" },
					h("div", { className: "lkb-scFieldLabel" }, label),
					h(
						"div",
						{ className: "lkb-rangeGroup" },
						h("input", { className: "lkb-input", value: f[lo], onChange: set(lo), placeholder: "最低" }),
						h("span", { className: "lkb-rangeTilde" }, "—"),
						h("input", { className: "lkb-input", value: f[hi], onChange: set(hi), placeholder: "最高" })
					)
				);
			const scoreTier = (s) => (s >= 85 ? "3" : s >= 70 ? "2" : s >= 50 ? "1" : "0");
			return h(
				"div",
				{ className: "lkb-sc" },
				h(
					"div",
					{ className: "lkb-scHead" },
					h(
						"div",
						null,
						h("div", { className: "lkb-scTitle" }, "🔍 智能选股"),
						h(
							"div",
							{ className: "lkb-scSub" },
							mode === "multi"
								? "多策略交叉选股 —— 同时满足多个预设策略（交集）才入选，策略数越高越强势"
								: "股票池 · 基础条件 · 技术信号 —— 实时日K计算指标，综合评分排序"
						)
					),
					h(
						"div",
						{ className: "lkb-seg", style: { marginLeft: 0 } },
						h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "standard" ? "true" : "false", onClick: () => setMode("standard") }, "评分选股"),
						h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "multi" ? "true" : "false", onClick: () => setMode("multi") }, "多策略交叉")
					),
					selCount > 0 ? h("span", { className: "lkb-sigCount", style: { fontSize: 11.5, padding: "3px 12px" }, "data-n": "true" }, mode === "multi" ? `已选 ${selCount} 个策略` : `已选 ${selCount} 个信号`) : null
				),
				h(
					"div",
					{ className: "lkb-scCard" },
					h(
						"div",
						{ className: "lkb-scRow" },
						h(
							"div",
							{ className: "lkb-condBlock" },
							h("div", { className: "lkb-scFieldLabel" }, "市场板块"),
							h("div", { className: "lkb-seg" }, NODE_CHIPS.map((c) => h("button", { key: c.v, type: "button", className: "lkb-segBtn", "data-active": node === c.v ? "true" : "false", onClick: () => setNode(c.v) }, c.label)))
						),
						h(
							"div",
							{ className: "lkb-condBlock" },
							h("div", { className: "lkb-scFieldLabel" }, "样本范围"),
							h(
								"select",
								{ className: "lkb-input lkb-scSelect", value: String(universe), onChange: (e) => setUniverse(Number(e.target.value)) },
								UNIVERSE_OPTS.map(([v, l]) => h("option", { value: v, key: v }, l))
							)
						),
						h(
							"div",
							{ className: "lkb-condBlock", style: { marginLeft: "auto" } },
							h("div", { className: "lkb-scFieldLabel" }, "风险过滤"),
							h("label", { className: "lkb-switch", "data-on": excludeST ? "true" : "false", onClick: () => setExcludeST((v) => !v) }, h("span", { className: "lkb-switchTrack" }), "排除 ST")
						)
					),
					h("div", { className: "lkb-scDivider" }),
					h(
						"div",
						{ className: "lkb-scRow" },
						rangeField("价格 ¥", "minPrice", "maxPrice"),
						rangeField("换手率 %", "minTurnover", "maxTurnover"),
						rangeField("今日涨幅 %", "minChange", "maxChange")
					),
					h("div", { className: "lkb-scDivider" }),
					mode === "multi"
						? h(
								"div",
								{ className: "lkb-condBlock" },
								h("div", { className: "lkb-scFieldLabel" }, "预设策略（勾选参与交叉，个股需同时命中其中多个）"),
								h(
									"div",
									{ className: "lkb-sigGroups" },
									SCREEN_STRATEGIES.map((s) => {
										const on = strategies[s.key] === true;
										return h(
											"button",
											{ key: s.key, type: "button", className: "lkb-chip2", "data-on": on ? "true" : "false", onClick: toggleStrat(s.key), title: s.desc, style: { flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "7px 11px" } },
											h("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 } }, h("span", { className: "lkb-chip2Dot" }), s.label),
											h("span", { style: { fontSize: 10.5, color: "#868e96", fontWeight: 400 } }, s.desc)
										);
									})
								),
								h(
									"div",
									{ className: "lkb-scRow", style: { gap: 12, alignItems: "center" } },
									h(
										"div",
										{ className: "lkb-condBlock" },
										h("div", { className: "lkb-scFieldLabel" }, "至少命中策略数"),
										h(
											"div",
											{ className: "lkb-rangeGroup" },
											h(
												"select",
												{ className: "lkb-input lkb-scSelect", value: String(minHits), onChange: (e) => setMinHits(Number(e.target.value)) },
												[1, 2, 3, 4, 5].map((n) => h("option", { value: String(n), key: n }, `${n} 个策略`))
											)
										)
									)
								)
							)
						: h(
								"div",
								{ className: "lkb-condBlock" },
								h("div", { className: "lkb-scFieldLabel" }, "技术信号（勾选 = 必须满足，全部参与加权评分）"),
								h(
									"div",
									{ className: "lkb-sigGroups" },
									SCREEN_GROUPS.map((g) => {
										const n = g.items.filter((k) => require[k]).length;
										return h(
											"div",
											{ className: "lkb-sigGroup", key: g.key },
											h("div", { className: "lkb-sigGroupTitle" }, g.label, h("span", { className: "lkb-sigCount", "data-n": n > 0 ? "true" : "false" }, `${n}/${g.items.length}`)),
											h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, g.items.map((k) => h("button", { key: k, type: "button", className: "lkb-chip2", "data-on": require[k] ? "true" : "false", onClick: toggleReq(k) }, h("span", { className: "lkb-chip2Dot" }), SIGNAL_LABEL[k])))
										);
									})
								)
							),
					h("div", { className: "lkb-scDivider" }),
					h(
						"div",
						{ className: "lkb-scActions" },
						h("button", { className: "lkb-btnGhost", onClick: resetAll }, "重置"),
						mode === "standard"
							? h("div", { className: "lkb-rangeGroup" }, h("span", { className: "lkb-unit" }, "综合评分 ≥"), h("input", { className: "lkb-input lkb-scoreInput", value: minScore, onChange: (e) => setMinScore(e.target.value) }))
							: null,
						h("button", { className: "lkb-runBtn", disabled: running, onClick: run }, running ? "扫描中…" : "开始选股 ▸"),
						h("span", { className: "lkb-status", style: { marginLeft: "auto" } }, mode === "multi" ? "基于日K实时命中 MACD / 均线 / 布林 / 量能 / 超卖等多策略" : "基于日K实时计算 MACD / KDJ / RSI / 均线 / 布林")
					),
					running && progress
						? h(
								"div",
								{ className: "lkb-progressWrap" },
								h("div", { className: "lkb-status" }, stageText(progress)),
								pct !== null ? h("div", { className: "lkb-progress" }, h("div", { className: "lkb-progressBar", style: { width: pct + "%" } })) : null
							)
						: null
				),
				error === "" ? null : h("div", { className: "lkb-error" }, error),
				ran && !running && error === "" && rows.length === 0
					? h(
							"div",
							{ className: "lkb-emptyState" },
							h("div", { className: "lkb-emptyIcon" }, "🫥"),
							"没有符合条件的股票",
							h("div", { style: { marginTop: 4, fontSize: 11.5 } }, mode === "multi" ? "试试勾选更多策略，或降低「至少命中策略数」门槛" : "试试放宽价格 / 换手区间，或减少必选信号")
						)
					: null,
				rows.length > 0
					? h(
							"div",
							{ className: "lkb-resCard" },
							h(
								"div",
								{ className: "lkb-resSummary" },
								h("span", null, mode === "multi" ? `共 ${rows.length} 只匹配 · 按命中策略数排序` : `共 ${rows.length} 只匹配 · 按综合评分排序`),
								h("span", { className: "lkb-status" }, "首批扫描较慢 · 结果有缓存")
							),
							h(
								"table",
								null,
								h(
									"thead",
									null,
									h(
										"tr",
										null,
										h("th", null, "#"),
										h("th", null, "名称"),
										mode === "multi" ? h("th", null, "命中") : h("th", null, "评分"),
										h("th", null, "现价"),
										h("th", null, "涨跌幅"),
										h("th", null, "换手"),
										h("th", null, "量比"),
										h("th", null, mode === "multi" ? "命中的策略" : "信号"),
										h("th", null, "")
									)
								),
								h(
									"tbody",
									null,
									rows.map((r, i) =>
										h(
											"tr",
											{ key: r.symbol, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
											h("td", null, h("span", { className: "lkb-rankNum", "data-medal": i < 3 ? String(i + 1) : void 0 }, i + 1)),
											h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
											mode === "multi"
												? h("td", null, h("span", { className: "lkb-scorePill", "data-tier": (r.strategyCount ?? 0) >= 4 ? "3" : (r.strategyCount ?? 0) >= 3 ? "2" : "1" }, r.strategyCount ?? 0))
												: h("td", null, h("span", { className: "lkb-scorePill", "data-tier": scoreTier(r.score ?? 0) }, r.score)),
											h("td", { className: trend(r.change) }, fmt(r.price)),
											h("td", { className: trend(r.change) }, fmtPct(r.changePct)),
											h("td", null, r.turnoverRate === null ? "—" : fmt(r.turnoverRate) + "%"),
											h("td", null, r.volumeRatio === null ? "—" : fmt(r.volumeRatio)),
											h(
												"td",
												null,
												h(
													"span",
													{ className: "lkb-signalTags" },
													(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).slice(0, 3).map((t) => h("span", { className: "lkb-signalTag", key: t }, t)),
													(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).length > 3 ? h("span", { className: "lkb-signalMore", key: "__more" }, `+${(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).length - 3}`) : null
												)
											),
											h("td", null, h(StarButton, { code: r.code, name: r.name, on: isWatched(watchSet, r.code), confirmText: `确定将 ${r.name}（${r.code}）移出自选吗？` }))
										)
									)
								)
							)
						)
					: null
			);
		}
		//#endregion

		//#region NewsTab
		const NEWS_SOURCES = [
			{ key: "all", label: "全部" },
			{ key: "sina", label: "新浪" },
			{ key: "em", label: "东财" },
			{ key: "jin10", label: "金十" },
		];
		const NEWS_SOURCE_LABEL = { sina: "新浪", em: "东财", jin10: "金十" };
		/** Duplicate-guard key (mirrors the server's text normalization). */
		const newsTextKey = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

		function NewsTab({ onOpen }) {
			const [items, setItems] = useState([]);
			const [page, setPage] = useState(1);
			const [hasMore, setHasMore] = useState(false);
			const [loading, setLoading] = useState(false);
			const [src, setSrc] = useState("all");
			const [error, setError] = useState("");
			const load = useCallback((p, append, source) => {
				setLoading(true);
				api(API.news + `?source=${source}&page=${p}&size=30`)
					.then((data) => {
						const incoming = data.items ?? [];
						setItems((prev) => {
							if (!append) return incoming;
							// The server re-merges per request and the feeds shift
							// between pages, so skip anything already on screen.
							const seenId = new Set(prev.map((n) => n.id));
							const seenText = new Set(prev.map((n) => newsTextKey(n.text)));
							return [
								...prev,
								...incoming.filter((n) => !seenId.has(n.id) && !seenText.has(newsTextKey(n.text))),
							];
						});
						setHasMore(p < (data.totalPage ?? 1));
						setError("");
					})
					.catch((e) => setError(e.message))
					.finally(() => setLoading(false));
			}, []);
			useEffect(() => {
				setPage(1);
				load(1, false, src);
			}, [load, src]);
			useInterval(() => load(1, false, src), 60000);
			const more = () => {
				const next = page + 1;
				setPage(next);
				load(next, true, src);
			};
			return h(
				"div",
				null,
				h(
					"div",
					{ className: "lkb-chipRow" },
					NEWS_SOURCES.map((c) =>
						h(
							"button",
							{ key: c.key, className: "lkb-chip", "data-active": src === c.key ? "true" : "false", onClick: () => setSrc(c.key) },
							c.label
						)
					)
				),
				h("div", { className: "lkb-status" }, "7×24 财经快讯（新浪 · 东财 · 金十） · 每 60 秒自动刷新 · 红色为重要资讯"),
				error === "" ? null : h("div", { className: "lkb-error" }, error),
				items.map((n) =>
					h(
						"div",
						{ className: "lkb-newsItem" + (n.important ? " lkb-newsImportant" : ""), key: n.id },
						h(
							"div",
							{ className: "lkb-newsMeta" },
							h("span", null, n.time),
							h("span", { className: "lkb-srcBadge" }, NEWS_SOURCE_LABEL[n.source] ?? n.source ?? ""),
							n.important ? h("span", { className: "lkb-newsFlag" }, "重要") : null,
							(n.tags ?? []).map((t) => h("span", { className: "lkb-newsTag", key: t }, t))
						),
						h("div", { className: "lkb-newsText" }, n.text),
						(n.stocks ?? []).length > 0
							? h(
									"div",
									{ className: "lkb-newsStocks" },
									(n.stocks ?? []).map((s) =>
										h(
											"span",
											{
												className: "lkb-stockChip",
												key: s.symbol,
												onClick: (e) => {
													e.stopPropagation();
													onOpen(s.symbol, s.name);
												},
											},
											`${s.name} ${s.symbol}`
										)
									)
								)
							: null
					)
				),
				loading && items.length === 0 ? h("div", { className: "lkb-empty" }, "加载中…") : null,
				hasMore
					? h("div", { className: "lkb-pager" }, h("button", { className: "lkb-btnGhost", onClick: more, disabled: loading }, loading ? "加载中…" : "加载更多"))
					: null
			);
		}
		//#endregion

		//#region stock detail popup window
		const UP_COLOR = "#e03131";
		const DOWN_COLOR = "#0f9d6e";
		const MA_DEFS = [
			{ n: 5, color: "#e8590c" },
			{ n: 10, color: "#4263eb" },
			{ n: 20, color: "#9c36b5" },
		];

		function maSeries(closes, n) {
			const out = new Array(closes.length).fill(null);
			let sum = 0;
			for (let i = 0; i < closes.length; i++) {
				sum += closes[i];
				if (i >= n) sum -= closes[i - n];
				if (i >= n - 1) out[i] = sum / n;
			}
			return out;
		}

		// 压力位/支撑位(逐日滚动):每日只用截至当日的最近 60 根K线,检测摆动高低点(左右各2根确认),不使用未来数据。
		// 压力位 = 收盘价上方最近的摆动高点,支撑位 = 下方最近的摆动低点(均为真实价格水平);
		// 无摆动点时回退经典枢轴点,区间极值兜底,恒保证 压力位 >= 收盘 >= 支撑位。仅用于悬停浮窗展示。
		function srLevels(klines, idx) {
			const L = 2;
			const win = klines.slice(Math.max(0, idx - 59), idx + 1);
			const m = win.length;
			const cur = klines[idx];
			let res = null;
			let sup = null;
			for (let i = L; i < m - L; i++) {
				let isH = true;
				let isL = true;
				for (let j = i - L; j <= i + L; j++) {
					if (j === i) continue;
					if (win[j].high >= win[i].high) isH = false;
					if (win[j].low <= win[i].low) isL = false;
				}
				if (isH && win[i].high > cur.close && (res === null || win[i].high < res)) res = win[i].high;
				if (isL && win[i].low < cur.close && (sup === null || win[i].low > sup)) sup = win[i].low;
			}
			if (m >= 2) {
				// 回退:经典枢轴点(前一根K线 P=(H+L+C)/3, R1=2P-L, S1=2P-H)
				const p = win[m - 2];
				const pp = (p.high + p.low + p.close) / 3;
				if (res === null) res = 2 * pp - p.low;
				if (sup === null) sup = 2 * pp - p.high;
			}
			// 最终兜底:区间极值
			if (res === null || res <= cur.close) res = Math.max(...win.map((b) => b.high));
			if (sup === null || sup >= cur.close) sup = Math.min(...win.map((b) => b.low));
			return { res, sup };
		}

		function shortDate(d) {
			const s = String(d ?? "");
			if (s.includes("-")) return s.slice(5); // 2025-01-06 -> 01-06
			if (/^\d{12}$/.test(s)) return `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
			return s;
		}

		function KlineChart({ klines }) {
			const [hover, setHover] = useState(null);
			const kwrapRef = useRef(null);
			const W = 900;
			const PRICE_H = 188;
			const GAP = 10;
			const VOL_H = 52;
			const H = PRICE_H + GAP + VOL_H;
			if (!Array.isArray(klines) || klines.length < 2) return h("div", { className: "lkb-empty" }, "暂无K线数据");
			const n = klines.length;
			const step = W / n;
			const xc = (i) => i * step + step / 2;
			const closes = klines.map((k) => k.close);
			const mas = MA_DEFS.map((d) => maSeries(closes, d.n));
			let min = Math.min(...klines.map((k) => k.low));
			let max = Math.max(...klines.map((k) => k.high));
			for (const series of mas) {
				for (const v of series) {
					if (v !== null) {
						if (v < min) min = v;
						if (v > max) max = v;
					}
				}
			}
			if (!(max > min)) {
				min -= 1;
				max += 1;
			}
			const pad = (max - min) * 0.06;
			min -= pad;
			max += pad;
			const py = (v) => 4 + (1 - (v - min) / (max - min)) * (PRICE_H - 8);
			const maxVol = Math.max(...klines.map((k) => k.volume)) || 1;
			const volBase = PRICE_H + GAP + VOL_H - 2;
			const vh = (v) => Math.max(1, (v / maxVol) * (VOL_H - 6));
			const bodyW = Math.max(1.5, Math.min(step * 0.64, 12));
			const barColor = (i) => (klines[i].close >= klines[i].open ? UP_COLOR : DOWN_COLOR);
			const hi = hover === null ? n - 1 : Math.min(Math.max(hover.i, 0), n - 1);
			const hb = klines[hi];
			const hPrev = hi > 0 ? klines[hi - 1].close : hb.open;
			const hPct = hPrev ? ((hb.close - hPrev) / hPrev) * 100 : null;
			const sr = srLevels(klines, hi);
			const onMove = (e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				if (rect.width <= 0) return;
				const i = Math.min(Math.max(Math.floor(((e.clientX - rect.left) / rect.width) * n), 0), n - 1);
				setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
			};
			const gridYs = [0, 1 / 3, 2 / 3, 1].map((f) => 4 + f * (PRICE_H - 8));
			const ticks = [...new Set(Array.from({ length: 6 }, (_, k) => Math.round((k * (n - 1)) / 5)))];
			const tipW = 168;
			const tipH = 196;
			const wrapW = kwrapRef.current !== null && kwrapRef.current.clientWidth > 0 ? kwrapRef.current.clientWidth : W;
			const tipLeft = hover === null ? 0 : hover.x + 14 + tipW > wrapW ? Math.max(0, hover.x - 14 - tipW) : hover.x + 14;
			const tipTop = hover === null ? 0 : hover.y + 14 + tipH > H ? Math.max(0, hover.y - 14 - tipH) : hover.y + 14;
			return h(
				"div",
				null,
				h(
					"div",
					{ className: "lkb-kwrap", ref: kwrapRef, onMouseMove: onMove, onMouseLeave: () => setHover(null) },
					h(
						"svg",
						{ viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: { width: "100%", height: H, display: "block" } },
						gridYs.map((y, gi) =>
							h("line", { key: "g" + gi, x1: 0, x2: W, y1: y, y2: y, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" })
						),
						klines.map((_, i) => {
							const b = klines[i];
							const color = barColor(i);
							const x = xc(i);
							const yO = py(b.open);
							const yC = py(b.close);
							const top = Math.min(yO, yC);
							const bh = Math.max(1, Math.abs(yO - yC));
							return h(
								"g",
								{ key: i },
								h("line", { x1: x, x2: x, y1: py(b.high), y2: py(b.low), stroke: color, strokeWidth: 1, vectorEffect: "non-scaling-stroke" }),
								h("rect", { x: x - bodyW / 2, y: top, width: bodyW, height: bh, fill: color })
							);
						}),
						mas.map((series, mi) => {
							const pts = [];
							for (let i = 0; i < n; i++) if (series[i] !== null) pts.push(`${xc(i).toFixed(1)},${py(series[i]).toFixed(1)}`);
							return pts.length > 1
								? h("polyline", { key: "ma" + mi, points: pts.join(" "), fill: "none", stroke: MA_DEFS[mi].color, strokeWidth: 1.1, vectorEffect: "non-scaling-stroke", opacity: 0.95 })
								: null;
						}),
						h("line", {
							x1: 0,
							x2: W,
							y1: py(klines[n - 1].close),
							y2: py(klines[n - 1].close),
							stroke: barColor(n - 1),
							strokeDasharray: "5 4",
							strokeWidth: 0.8,
							vectorEffect: "non-scaling-stroke",
							opacity: 0.8,
						}),
						h("line", { x1: 0, x2: W, y1: PRICE_H + GAP / 2, y2: PRICE_H + GAP / 2, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" }),
						klines.map((k, i) =>
							h("rect", {
								key: "v" + i,
								x: xc(i) - bodyW / 2,
								y: volBase - vh(k.volume),
								width: bodyW,
								height: vh(k.volume),
								fill: barColor(i),
								opacity: 0.55,
							})
						),
						hover !== null && hover.i >= 0 && hover.i < n
							? h("line", { x1: xc(hover.i), x2: xc(hover.i), y1: 2, y2: volBase, stroke: "#868e96", strokeDasharray: "4 3", strokeWidth: 0.8, vectorEffect: "non-scaling-stroke" })
							: null
					),
					hover === null
						? null
						: h(
							"div",
							{ className: "lkb-kTip", style: { left: tipLeft, top: tipTop } },
							h("div", { className: "tipDate" }, shortDate(hb.date)),
							h("span", null, "开"), h("b", null, fmt(hb.open)),
							h("span", null, "高"), h("b", null, fmt(hb.high)),
							h("span", null, "低"), h("b", null, fmt(hb.low)),
							h("span", null, "收"), h("b", { className: trend(hPct) }, fmt(hb.close), " ", fmtPct(hPct)),
							h("span", null, "量"), h("b", null, fmtVol(hb.volume)),
							mas.flatMap((series, mi) => [
								h("span", { className: "ma" + MA_DEFS[mi].n, key: "m" + MA_DEFS[mi].n }, `MA${MA_DEFS[mi].n}`),
								h("b", { key: "v" + MA_DEFS[mi].n, className: "ma" + MA_DEFS[mi].n }, series[hi] === null ? "—" : fmt(series[hi]))
							]),
							h("span", { className: "srRes" }, "压力位"), h("b", { className: "srRes" }, fmt(sr.res)),
							h("span", { className: "srSup" }, "支撑位"), h("b", { className: "srSup" }, fmt(sr.sup))
						),
					h(
						"div",
						{ className: "lkb-kaxis" },
						ticks.map((ti) =>
							h("span", { key: ti, style: { left: `${Math.min(96, Math.max(4, (xc(ti) / W) * 100))}%` } }, shortDate(klines[ti]?.date))
						)
					)
				)
			);
		}

		function StockDetailWindow({ code, name, isIndex, x, y, z, onFocus, onClose, onWatched }) {
			const [q, setQ] = useState(null);
			const [klines, setKlines] = useState([]);
			const [period, setPeriod] = useState("day");
			const [watching, setWatching] = useState(false);
			const [fflow, setFflow] = useState(null);
			const [error, setError] = useState("");
			const [kError, setKError] = useState("");
			const cardRef = useRef(null);
			const [pos, setPos] = useState({ x, y });
			useEffect(() => {
				let alive = true;
				setError("");
				api(API.quote + `?codes=${code}`)
					.then((d) => alive && setQ((d.quotes ?? [])[0] ?? null))
					.catch((e) => alive && setError(e.message));
				api(API.watchlist)
					.then((d) => alive && setWatching((d.watchlist ?? []).some((e) => e.code === code)))
					.catch(() => {});
				return () => {
					alive = false;
				};
			}, [code]);
			useEffect(() => {
				let alive = true;
				setKError("");
				api(API.kline + `?code=${code}&period=${period}&count=120&fq=qfq`)
					.then((d) => {
						if (alive) setKlines(d.klines ?? []);
					})
					.catch((e) => {
						if (alive) {
							setKlines([]);
							setKError(e.message);
						}
					});
				return () => {
					alive = false;
				};
			}, [code, period]);
			useEffect(() => {
				let alive = true;
				api(API.fflow + `?code=${code}&count=30`)
					.then((d) => alive && setFflow((d.rows ?? []).slice(-8)))
					.catch(() => alive && setFflow(null));
				return () => {
					alive = false;
				};
			}, [code]);
			useTradingInterval(
				() => {
					api(API.quote + `?codes=${code}`)
						.then((d) => setQ((d.quotes ?? [])[0] ?? null))
						.catch(() => {});
				},
				10000,
				[code]
			);
			const toggleWatch = () => {
				api(API.watchlist + (watching ? "/remove" : "/add"), { method: "POST", body: { code, name } })
					.then(() => {
						setWatching(!watching);
						onWatched?.();
					})
					.catch(() => {});
			};
			const onHeadDown = (e) => {
				if (e.button !== 0) return;
				if (e.target.closest("button") !== null) return; // let buttons work normally
				e.preventDefault();
				const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
				if (rect === null) return;
				const startX = e.clientX;
				const startY = e.clientY;
				const baseLeft = rect.left;
				const baseTop = rect.top;
				const clampX = (v) => Math.max(8 - rect.width + 80, Math.min(v, window.innerWidth - 80));
				const clampY = (v) => Math.max(8, Math.min(v, window.innerHeight - 40));
				const onMove = (ev) => setPos({ x: clampX(baseLeft + ev.clientX - startX), y: clampY(baseTop + ev.clientY - startY) });
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					document.body.style.userSelect = "";
				};
				document.body.style.userSelect = "none";
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			const centerWindow = () => {
				const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
				if (rect === null) return;
				setPos({
					x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
					y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
				});
			};
			const item = (label, value, cls) => h("div", { className: "lkb-qItem" }, h("div", { className: "lkb-qLabel" }, label), h("div", { className: "lkb-qValue " + (cls ?? "") }, value));
			const mkt = cnMarket(String(code ?? "").slice(0, 2).toUpperCase());
			return h(
				"div",
				{ className: "lkb-win", ref: cardRef, style: { left: pos.x, top: pos.y, zIndex: z }, onPointerDown: onFocus },
				h(
					"div",
					{ className: "lkb_head", title: "拖动移动窗口 · 双击居中", onPointerDown: onHeadDown, onDoubleClick: centerWindow },
					h("span", { className: "lkb-headTitle" }, h("span", { className: "lkb-logo" }, "📈"), name ?? code, h("span", { className: "lkb-code" }, code), mkt === "" ? null : h("span", { className: "lkb-mktTag" }, mkt)),
					h(
						"div",
						{ className: "lkb_headRight" },
						isIndex
							? h("span", { className: "lkb-mktTag", title: "指数不可交易" }, "指数")
							: h("button", { className: "lkb-btnGhost", onClick: toggleWatch }, watching ? "★ 已自选" : "☆ 加自选"),
						h("button", { className: "lkb_close", title: "关闭", onClick: onClose }, "✕")
					)
				),
				h(
					"div",
					{ className: "lkb_body" },
					error === "" ? null : h("div", { className: "lkb-error" }, error),
					h(
						"div",
						{ className: "lkb-hero" },
						h(
							"div",
							{ className: "lkb-heroMain" },
							h("div", { className: "lkb-heroPrice " + trend(q?.change) }, fmt(q?.price)),
							h(
								"div",
								{ className: "lkb-heroSub " + trend(q?.change) },
								h("span", null, fmtSign(q?.change)),
								h("span", null, fmtPct(q?.changePct))
							),
							q?.time ? h("div", { className: "lkb-heroMeta" }, "更新 ", fmtTime(q.time)) : null,
							isIndex ? null : h("div", { className: "lkb-heroMeta" }, `涨停 ${fmt(q?.limitUp)} · 跌停 ${fmt(q?.limitDown)}`)
						),
						h(
							"div",
							{ className: "lkb-heroGrid" },
							item("今开", fmt(q?.open)),
							item("昨收", fmt(q?.prevClose)),
							item("最高", fmt(q?.high), "lkb-up"),
							item("最低", fmt(q?.low), "lkb-down"),
							item("成交量", q?.volume === null || q?.volume === void 0 ? "—" : fmtVol(q.volume)),
							item("成交额", q?.amount === null || q?.amount === void 0 ? "—" : fmtAmount((q?.amount ?? 0) * 10000)),
							item("换手率", q?.turnoverRate === null || q?.turnoverRate === void 0 ? "—" : fmt(q?.turnoverRate) + "%"),
							item("量比", fmt(q?.volumeRatio)),
							item("振幅", q?.amplitude === null || q?.amplitude === void 0 ? "—" : fmt(q?.amplitude) + "%"),
							item("市盈率", fmt(q?.pe)),
							item("市净率", fmt(q?.pb)),
							item("总市值", q?.totalMv === null || q?.totalMv === void 0 ? "—" : fmt(q?.totalMv) + "亿"),
							item("流通市值", q?.floatMv === null || q?.floatMv === void 0 ? "—" : fmt(q?.floatMv) + "亿")
						)
					),
					h(
						"div",
						{ className: "lkb-chartBox" },
						h(
							"div",
							{ className: "lkb-chartTitle" },
							"K线（前复权）",
							h(
								"span",
								{ className: "lkb-periodRow" },
								["day", "week", "month", "m1", "m5", "m15", "m30", "m60"].map((p) =>
									h("button", { key: p, className: "lkb-period", "data-active": period === p ? "true" : "false", onClick: () => setPeriod(p) }, { day: "日K", week: "周K", month: "月K", m1: "分时", m5: "5分", m15: "15分", m30: "30分", m60: "60分" }[p])
								)
							)
						),
						kError === "" ? null : h("div", { className: "lkb-error" }, kError),
						h(KlineChart, { klines })
					),
					fflow !== null && fflow.length > 0
						? h(
								"div",
								{ className: "lkb-chartBox" },
								h("div", { className: "lkb-chartTitle" }, "资金流向（最近几日，单位：亿）"),
								h(
									"table",
									{ style: { fontSize: 11 } },
									h(
										"thead",
										null,
										h("tr", null, h("th", null, "日期"), h("th", null, "主力净流入"), h("th", null, "超大单"), h("th", null, "大单"), h("th", null, "中单"), h("th", null, "小单"))
									),
									h(
										"tbody",
										null,
										fflow.map((r) =>
											h(
												"tr",
												{ key: r.date },
												h("td", { className: "lkb-code" }, r.date.slice(5)),
												h("td", { className: trend(r.main) }, fmtYi(r.main)),
												h("td", { className: trend(r.xl) }, fmtYi(r.xl)),
												h("td", { className: trend(r.big) }, fmtYi(r.big)),
												h("td", { className: trend(r.middle) }, fmtYi(r.middle)),
												h("td", { className: trend(r.small) }, fmtYi(r.small))
											)
										)
									)
								)
							)
						: null
				)
			);
		}
		//#endregion

		//#region panel
		const TABS = [
			{ key: "indices", label: "📊 大盘" },
			{ key: "market", label: "💹 行情" },
			{ key: "watchlist", label: "⭐ 自选" },
			{ key: "screener", label: "🔍 选股" },
			{ key: "news", label: "📰 快讯" },
		];

		function LeekBoxPanel({ onClose }) {
			const [tab, setTab] = useState("indices");
			const [wins, setWins] = useState([]); // open stock-detail popups: {id, code, name, x, y, z}
			const winsRef = useRef([]);
			winsRef.current = wins;
			const zSeq = useRef(10100);
			const [watchBump, setWatchBump] = useState(0);
			const [watchCodes, setWatchCodes] = useState([]);
			const [pos, setPos] = useState(() => {
				try {
					const raw = localStorage.getItem("leekbox.panel.pos");
					if (raw !== null) {
						const p = JSON.parse(raw);
						if (typeof p.x === "number" && typeof p.y === "number") return p;
					}
				} catch {}
				return null;
			});
			const cardRef = useRef(null);
			const savePos = (p) => {
				try {
					localStorage.setItem("leekbox.panel.pos", JSON.stringify(p));
				} catch {}
			};
			// Center on first open when no saved position exists.
			useEffect(() => {
				if (pos === null && cardRef.current !== null) {
					const rect = cardRef.current.getBoundingClientRect();
					setPos({
						x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
						y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
					});
				}
			}, [pos]);
			// Drag the window by its header.
			const onHeadPointerDown = (e) => {
				if (e.button !== 0) return;
				if (e.target.closest("button") !== null) return; // let buttons work normally
				e.preventDefault();
				const startX = e.clientX;
				const startY = e.clientY;
				const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
				if (rect === null) return;
				const baseLeft = rect.left;
				const baseTop = rect.top;
				const clampX = (x) => Math.max(8 - rect.width + 60, Math.min(x, window.innerWidth - 60));
				const clampY = (y) => Math.max(8, Math.min(y, window.innerHeight - 40));
				const onMove = (ev) => {
					const p = { x: clampX(baseLeft + ev.clientX - startX), y: clampY(baseTop + ev.clientY - startY) };
					setPos(p);
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					document.body.style.userSelect = "";
					if (cardRef.current !== null) {
						const r = cardRef.current.getBoundingClientRect();
						savePos({ x: r.left, y: r.top });
					}
				};
				document.body.style.userSelect = "none";
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			const resetPos = () => {
				const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
				if (rect === null) return;
				const p = {
					x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
					y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
				};
				setPos(p);
				savePos(p);
			};
			const openStock = useCallback((rawCode, rawName) => {
				const code = normCode(rawCode ?? "");
				if (!/^(sh|sz|bj)\d{6}$/.test(code)) return;
				const name = rawName ?? rawCode;
				// Index codes (上证/深证系列、北证指数) open a quote window too — but
				// they are not tradable: no 加自选 and no 涨停/跌停 display.
				const isIndex = /^(sh000|sz399|sh899|bj899)/.test(code);
				setWins((prev) => {
					const exist = prev.find((w) => w.code === code);
					zSeq.current += 1;
					if (exist) return prev.map((w) => (w.id === exist.id ? { ...w, z: zSeq.current } : w));
					const k = prev.length % 6;
					const wx = Math.max(8, Math.round((window.innerWidth - 760) / 2)) + k * 28;
					const wy = Math.max(8, Math.round((window.innerHeight - 620) / 2)) + k * 26;
					return [
						...prev,
						{
							id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
							code,
							name,
							isIndex,
							x: wx,
							y: wy,
							z: zSeq.current,
						},
					];
				});
			}, []);
			const focusWin = (id) =>
				setWins((prev) => {
					zSeq.current += 1;
					const zz = zSeq.current;
					return prev.map((w) => (w.id === id ? { ...w, z: zz } : w));
				});
			const closeWin = (id) => setWins((prev) => prev.filter((w) => w.id !== id));
			const closeTopWin = () => setWins((prev) => prev.slice(0, -1));
			const bumpWatch = () => setWatchBump((v) => v + 1);
			// In-panel confirm dialog host (replaces native window.confirm).
			const [confirmReq, setConfirmReq] = useState(null);
			useEffect(() => {
				const listener = (req) => setConfirmReq(req);
				confirmListeners.add(listener);
				return () => {
					confirmListeners.delete(listener);
					// The panel is unmounting (✕ / overlay click with the dialog
					// open): resolve the pending confirm, otherwise the module-level
					// confirmState stays set and every later lkbConfirm silently
					// resolves false — stars stop working until the page reloads.
					closeConfirm(false);
				};
			}, []);
			// ESC closes the top-most detail popup first, then the panel itself.
			useEffect(() => {
				const onKey = (e) => {
					if (e.key !== "Escape") return;
					const t = e.target;
					if (t !== null && t !== void 0 && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
					if (winsRef.current.length > 0) setWins((prev) => prev.slice(0, -1));
					else onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			useEffect(() => {
				let alive = true;
				const refresh = () =>
					api(API.watchlist)
						.then((d) => {
							if (alive) setWatchCodes((d.watchlist ?? []).map((e) => normCode(e.code)));
						})
						.catch(() => {});
				refresh();
				const timer = setInterval(refresh, 20000);
				// StarButton broadcasts this so ★ state updates without waiting for
				// the next 20s poll.
				window.addEventListener("leekbox:watchlist-changed", refresh);
				return () => {
					alive = false;
					clearInterval(timer);
					window.removeEventListener("leekbox:watchlist-changed", refresh);
				};
			}, []);
			const mkt = marketOpenLabel();
			const body =
				tab === "indices"
					? h(IndicesTab, { onOpen: openStock })
					: tab === "market"
						? h(MarketTab, { onOpen: openStock, watchCodes })
						: tab === "watchlist"
							? h(WatchlistTab, { onOpen: openStock, bump: watchBump })
							: tab === "screener"
								? h(ScreenerTab, { onOpen: openStock, watchCodes })
								: h(NewsTab, { onOpen: openStock });
			return h(
				"div",
				{
					className: "lkb_overlay",
					onClick: (e) => {
						if (e.target !== e.currentTarget) return;
						if (winsRef.current.length > 0) closeTopWin();
						else onClose();
					},
				},
				h(
					"div",
					{
						ref: cardRef,
						className: "lkb_card",
						style: pos === null ? { left: "50%", top: "50%", transform: "translate(-50%,-50%)" } : { left: pos.x, top: pos.y },
					},
					h(
						"div",
						{ className: "lkb_head", title: "拖动移动窗口 · 双击复位", onPointerDown: onHeadPointerDown, onDoubleClick: resetPos },
						h("span", { className: "lkb-headTitle" }, h("span", { className: "lkb-logo" }, "🥬"), "韭菜盒子"),
						h(
							"div",
							{ className: "lkb_headRight" },
							h("span", { className: "lkb_mktStatus", "data-open": mkt.open ? "true" : "false" }, mkt.label),
							h("button", { className: "lkb_close", title: "关闭", onClick: onClose }, "✕")
						)
					),
					h(
						"div",
						{ className: "lkb_tabs" },
						TABS.map((t) => h("button", { key: t.key, className: "lkb_tab", "data-active": tab === t.key ? "true" : "false", onClick: () => setTab(t.key) }, t.label))
					),
					h("div", { className: "lkb_body" }, body),
					h(
						"div",
						{ className: "lkb_foot" },
						h("span", null, "数据来源：腾讯财经 / 新浪财经 / 东方财富 / 金十数据"),
						h("span", null, "仅供研究参考，不构成投资建议。股市有风险，入市需谨慎。")
					)
				),
				wins.map((w) =>
					h(StockDetailWindow, {
						key: w.id,
						code: w.code,
						name: w.name,
						isIndex: w.isIndex === true,
						x: w.x,
						y: w.y,
						z: w.z,
						onFocus: () => focusWin(w.id),
						onClose: () => closeWin(w.id),
						onWatched: bumpWatch,
					})
				),
				confirmReq === null ? null : h(ConfirmDialog, { text: confirmReq.text })
			);
		}

		function mountPanel() {
			let root;
			let container;
			const close = () => {
				if (root === void 0) return;
				root.unmount();
				root = void 0;
				container?.remove();
				container = void 0;
			};
			const open = () => {
				if (root !== void 0) return;
				container = document.createElement("div");
				container.dataset.dshLeekboxView = "";
				container.dataset.dshPlugin = "leekbox";
				document.body.appendChild(container);
				root = createRoot(container);
				root.render(h(LeekBoxPanel, { onClose: close }));
			};
			const toggle = () => {
				if (root !== void 0) close();
				else open();
			};
			return { toggle, open, close, dispose: close };
		}
		//#endregion

		//#region sidebar entry
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
		function mountSidebarEntry(options) {
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
		//#endregion

		//#region apply
		const inject = [];
		const ENTRY_CSS = {
			entry: "lkb_entry",
			entryIcon: "lkb_entryIcon",
			entryLabel: "lkb_entryLabel",
		};
		const ICON = "🥬";
		const ENTRY_SELECTOR = "[data-dsh-leekbox-entry]";

		function apply(ctx) {
			const panel = mountPanel();
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
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
