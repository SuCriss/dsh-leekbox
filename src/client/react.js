// 韭菜盒子 LeekBox — 客户端 bundle 源码：React 桥接
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
// React 走宿主 ModuleLoader 的 require()，绝不打包进产物——build.mjs 把
// react / react-dom/client 标为 external，factory(require) 提供 require。
import * as React from "react";
import { createRoot } from "react-dom/client";

export const h = React.createElement;
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useRef = React.useRef;
export const useCallback = React.useCallback;
export { createRoot };
