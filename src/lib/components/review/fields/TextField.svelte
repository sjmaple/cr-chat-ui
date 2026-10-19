<script lang="ts">
	import MarkdownRenderer from "$lib/components/chat/MarkdownRenderer.svelte";
	import type { ReviewQuote } from "$lib/types/MlReview";
	import { quoteAt } from "$lib/utils/review/view";
	import { offsetsWithin, quoteAnchors, type AnchoredQuote } from "../quoteAnchors";

	interface Props {
		value: string;
		markdown?: boolean;
		clamp?: boolean;
		quotes?: AnchoredQuote[];
		onanchors?: (lost: string[]) => void;
		/** a selection inside the field, cleared with undefined */
		onselect?: (quote: ReviewQuote | undefined) => void;
	}

	let {
		value,
		markdown = false,
		clamp = false,
		quotes = [],
		onanchors = () => {},
		onselect,
	}: Props = $props();

	let element: HTMLElement | undefined = $state();

	function readSelection() {
		if (!onselect || !element) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			onselect(undefined);
			return;
		}
		const offsets = offsetsWithin(element, selection.getRangeAt(0));
		onselect(offsets && quoteAt(element.textContent ?? "", offsets.start, offsets.end));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={element}
	data-review-quotable
	class={[
		"min-w-0 text-sm text-gray-700 dark:text-gray-200",
		markdown
			? "prose max-w-none text-sm dark:prose-invert prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
			: "break-words whitespace-pre-wrap",
		clamp && (markdown ? "max-h-24 overflow-hidden" : "line-clamp-3"),
	]}
	onmouseup={readSelection}
	onkeyup={readSelection}
	use:quoteAnchors={{ quotes, onanchors }}
>
	{#if markdown}
		<MarkdownRenderer content={value} />
	{:else}
		{value}
	{/if}
</div>
