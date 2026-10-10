<script lang="ts">
	import type { Connection } from '$lib/stores/connections.svelte';
	import type { QueryResult, Screen, ScreenNode as Node } from '$lib/types/screen';
	import { planQueries } from '$lib/screen/plan';
	import type { ScreenEdit } from '$lib/screen/edit';
	import { normalizeConfig } from '$lib/dashboard/config';
	import { WIDGET_META } from '$lib/dashboard/registry';
	import ScreenNode from './ScreenNode.svelte';

	interface Props {
		screen: Screen;
		conn: Connection;
		/** Hand edits (remove, move) on the panels; omit to just draw. */
		edit?: ScreenEdit;
	}

	let { screen, conn, edit }: Props = $props();

	/** Null until the first answer, so panels show skeletons, not "no data". */
	let results = $state.raw<Map<string, QueryResult> | null>(null);
	let requestId = 0;

	// Refetch when the data a screen needs changes, not whenever the spec
	// object does: an edit that only renames a panel keeps its numbers.
	let plan = $derived(planQueries(screen));
	let planKey = $derived(JSON.stringify(plan));

	async function load() {
		if (!conn.isAuthenticated) return;
		const id = ++requestId;
		const next = new Map<string, QueryResult>();
		try {
			const answers = await Promise.all(
				plan.map((p) => conn.client.query({ range: p.range, queries: p.queries }))
			);
			for (const answer of answers) for (const r of answer.results) next.set(r.id, r);
		} catch (e) {
			// The whole request failed (offline, 5xx): every panel says so, and
			// the next tick tries again.
			const error = e instanceof Error ? e.message : String(e);
			for (const p of plan)
				for (const q of p.queries) next.set(q.id, { id: q.id, series: [], error });
		}
		if (id === requestId) results = next;
	}

	$effect(() => {
		void planKey;
		if (!conn.isAuthenticated) return;
		results = null;
		void load();
		const timer = setInterval(load, 60_000);
		return () => {
			++requestId;
			clearInterval(timer);
		};
	});

	// Live cards read the shared SSE feed; hold it open while one is drawn.
	function needsLive(node: Node): boolean {
		switch (node.type) {
			case 'grid':
				return node.children.some(needsLive);
			case 'tabs':
				return node.tabs.some((t) => needsLive(t.child));
			case 'widget': {
				const config = normalizeConfig(node.config);
				return !!config && WIDGET_META[config.kind].needsLive;
			}
			default:
				return false;
		}
	}
	let live = $derived(conn.live);
	let wantsLive = $derived(needsLive(screen.root));
	$effect(() => {
		if (!wantsLive) return;
		live.acquire();
		return () => live.release();
	});
</script>

<ScreenNode node={screen.root} path="root" range={screen.range} {results} {conn} {edit} />
