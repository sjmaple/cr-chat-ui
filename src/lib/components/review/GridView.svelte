<script lang="ts">
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import { leadImageField, plainText, shownFields } from "$lib/utils/review/progress";
	import { imageUrl } from "$lib/utils/review/view";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonGrid from "~icons/carbon/grid";
	import CarbonMaximize from "~icons/carbon/maximize";
	import CarbonSquareOutline from "~icons/carbon/square-outline";

	interface Props {
		session: ReviewSession;
		onopen: (index: number) => void;
	}

	let { session, onopen }: Props = $props();

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let image = $derived(schema ? leadImageField(schema) : undefined);
	let caption = $derived(
		schema
			? shownFields(schema).find(
					(field) => field !== image && (field.type === "category" || field.type === "text")
				)
			: undefined
	);

	const selected = new SvelteSet<number>();
	let filter = $state<"all" | "commented">("all");
	let small = $state(false);
	let composing = $state(false);
	let text = $state("");
	let textEl: HTMLTextAreaElement | undefined = $state();

	const commentCount = (index: number) => session.draft(index)?.comments.length ?? 0;
	let commented = $derived(records.filter((_, index) => commentCount(index) > 0).length);
	let shown = $derived(
		records
			.map((record, index) => ({ record, index }))
			.filter(({ index }) => filter === "all" || commentCount(index) > 0)
	);

	function toggle(index: number) {
		if (selected.has(index)) selected.delete(index);
		else selected.add(index);
		if (selected.size === 0) composing = false;
	}

	async function compose() {
		composing = true;
		await tick();
		textEl?.focus();
	}

	/** one comment per selected record, the server keeps comments per record */
	function commentOnSelected() {
		const body = text.trim();
		if (!body) return;
		for (const index of selected) session.addComment(index, { body, field: image?.name });
		text = "";
		composing = false;
		selected.clear();
	}

	const both = (n: number) => (n === 2 ? "both" : `all ${n}`);
</script>

<div
	class="flex flex-none items-center gap-2 border-b border-gray-200 py-2.5 pr-3 pl-4 dark:border-gray-800"
>
	<div class="flex flex-1 gap-1.5" role="group" aria-label="Filter">
		{#each [["all", "All", records.length], ["commented", "Commented", commented]] as const as [key, label, count] (key)}
			<button
				type="button"
				class={[
					"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium",
					filter === key
						? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
						: "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300",
				]}
				aria-pressed={filter === key}
				onclick={() => (filter = key)}
			>
				{label}
				<span class={filter === key ? "opacity-70" : "text-gray-500 dark:text-gray-400"}
					>{count}</span
				>
			</button>
		{/each}
	</div>
	<div
		class="flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
		role="group"
		aria-label="Tile size"
	>
		<button
			type="button"
			class={[
				"h-[26px] rounded-md px-2.5 text-xs",
				small
					? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
					: "text-gray-500",
			]}
			aria-label="Small tiles"
			aria-pressed={small}
			onclick={() => (small = true)}
		>
			<CarbonGrid />
		</button>
		<button
			type="button"
			class={[
				"h-[26px] rounded-md px-2.5 text-xs",
				!small
					? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
					: "text-gray-500",
			]}
			aria-label="Large tiles"
			aria-pressed={!small}
			onclick={() => (small = false)}
		>
			<CarbonSquareOutline />
		</button>
	</div>
</div>

<div class="scrollbar-custom min-h-0 flex-1 overflow-y-auto p-4" data-grid-view>
	<div class={["grid gap-x-3.5 gap-y-[18px]", small ? "grid-cols-6" : "grid-cols-4"]}>
		{#each shown as { record, index } (index)}
			{@const src =
				image && typeof record.values[image.name] === "string"
					? imageUrl(record.values[image.name] as string)
					: undefined}
			{@const on = selected.has(index)}
			{@const notes = commentCount(index)}
			<div class="group relative">
				<button
					type="button"
					class="flex w-full flex-col gap-1.5 border-0 bg-transparent p-0 text-left"
					aria-label="Image {index + 1}{caption
						? `, ${plainText(record.values[caption.name])}`
						: ''}"
					aria-pressed={on}
					data-tile={index}
					onclick={() => toggle(index)}
					ondblclick={() => onopen(index)}
					onkeydown={(e) => {
						if (e.key !== "Enter") return;
						e.preventDefault();
						onopen(index);
					}}
				>
					<span
						class={[
							"relative block aspect-square overflow-hidden rounded-[10px] bg-gray-100 dark:bg-gray-800",
							on &&
								"shadow-[0_0_0_2px_white,0_0_0_4px_#2563eb] dark:shadow-[0_0_0_2px_#111,0_0_0_4px_#60a5fa]",
						]}
					>
						{#if src}
							<img {src} alt="" loading="lazy" class="block size-full object-cover" />
						{/if}
						{#if on}
							<span
								class="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-400"
							>
								<CarbonCheckmark class="text-xs" />
							</span>
						{/if}
						{#if notes > 0}
							<span
								class="absolute top-1.5 right-1.5 flex h-5 items-center gap-[3px] rounded-full bg-amber-200 px-1.5 text-[11px] font-bold text-gray-900"
							>
								<CarbonChat class="text-[10px]" />{notes}
							</span>
						{/if}
					</span>
					<span class="truncate text-[12.5px] text-gray-500 dark:text-gray-400">
						{#if caption}<b class="font-medium text-gray-900 dark:text-gray-100"
								>{plainText(record.values[caption.name])}</b
							> ·
						{/if}#{index + 1}
					</span>
				</button>
				<span class="pointer-events-none absolute inset-x-0 top-0 aspect-square">
					<button
						type="button"
						class="pointer-events-auto absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-lg bg-gray-900/75 text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-gray-900 focus-visible:opacity-100"
						aria-label="Open image {index + 1}"
						data-open-tile={index}
						onclick={() => onopen(index)}
					>
						<CarbonMaximize class="text-sm" />
					</button>
				</span>
			</div>
		{/each}
	</div>
</div>

{#if selected.size > 0 && session.editable}
	<div
		class="mx-4 mb-3 flex flex-none flex-col gap-2 rounded-xl bg-gray-900 py-2 pr-2 pl-3.5 text-white shadow-[0_6px_20px_rgba(0,0,0,0.18)] dark:bg-gray-100 dark:text-gray-900"
		data-selection-bar
	>
		{#if composing}
			<textarea
				bind:this={textEl}
				bind:value={text}
				rows="2"
				maxlength={2000}
				aria-label="Comment on the selected images"
				placeholder="One comment, added to each selected image"
				class="mt-1 mr-1.5 resize-y rounded-lg border-0 bg-white/10 px-2.5 py-2 text-[13px] text-white outline-none placeholder:text-white/50 dark:bg-black/5 dark:text-gray-900 dark:placeholder:text-gray-500"
				onkeydown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						composing = false;
					} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						commentOnSelected();
					}
				}}
			></textarea>
		{/if}
		<div class="flex items-center gap-2">
			<span class="flex-1 text-[13px] font-medium">{selected.size} selected</span>
			{#if composing}
				<button
					type="button"
					class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-gray-900 disabled:opacity-50 dark:bg-gray-900 dark:text-gray-100"
					disabled={!text.trim()}
					onclick={commentOnSelected}
				>
					Add to {selected.size === 1 ? "image" : both(selected.size)}
				</button>
			{:else}
				<button
					type="button"
					class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-gray-900 dark:bg-gray-900 dark:text-gray-100"
					onclick={compose}
				>
					<CarbonChat class="text-sm" />
					Comment on {selected.size === 1 ? "it" : both(selected.size)}
				</button>
			{/if}
			<button
				type="button"
				class="h-8 rounded-lg px-2.5 text-[13px] font-medium opacity-75 hover:opacity-100"
				onclick={() => {
					selected.clear();
					composing = false;
				}}
			>
				Clear
			</button>
		</div>
	</div>
{/if}
