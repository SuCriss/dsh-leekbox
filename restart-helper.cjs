// Detached helper: waits a short delay, then triggers the dsh-market
// self-restart so leekbox server-side changes (lib/index.js) take effect.
// Survives the current session because it is spawned detached.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	const port = process.env.LEEKBOX_RESTART_PORT || "58410";
	const delayMs = Number(process.env.LEEKBOX_RESTART_DELAY || 8000);
	const url = `http://127.0.0.1:${port}/dsh-market/restart`;
	await sleep(delayMs);
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					origin: `http://127.0.0.1:${port}`,
					host: `127.0.0.1:${port}`,
				},
			});
			const body = await res.text();
			console.log(`[leekbox-restart-helper] status=${res.status} body=${body.slice(0, 200)}`);
			if (res.status === 409) {
				// A plugin operation is running — retry shortly.
				await sleep(5000);
				continue;
			}
			return;
		} catch (err) {
			console.log(`[leekbox-restart-helper] retry: ${err.message}`);
			await sleep(5000);
		}
	}
	console.log("[leekbox-restart-helper] gave up");
}

main();
