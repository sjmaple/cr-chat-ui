<script lang="ts">
	import MarkdownRenderer from "$lib/components/chat/MarkdownRenderer.svelte";
	import type { ReviewQuote } from "$lib/types/MlReview";
	import { quoteAt } from "$lib/utils/review/view";
	import { offsetsWithin, quoteAnchors, type AnchoredQuote } from "../quoteAnchors";

	import CarbonAddComment from "~icons/carbon/add-comment";

	interface Props {
		value: string;
		markdown?: boolean;
		clamp?: boolean;
		quotes?: AnchoredQuote[];
		onanchors?: (lost: string[]) => void;
		/** offers a comment on a selection inside the field when set */
		oncomment?: (quote: ReviewQuote) => void;
	}

	let {
		value,
		markdown = false,
		clamp = false,
		quotes = [],
		onanchors = () => {},
		oncomment,
	}: Props = $props();

	/** room the popup needs above the selection before it flips below */
	const POPUP_ROOM = 36;

	let wrapper: HTMLElement | undefined = $state();
	let element: HTMLElement | undefined = $state();
	let pending = $state<{ quote: ReviewQuote; x: number; y: number; below: boolean } | undefined>(
		undefined
	);

	function selectedRange(): Range | undefined {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
		return selection.getRangeAt(0);
	}

	function readSelection() {
		if (!oncomment || !element || !wrapper) return;
		const range = selectedRange();
		const offsets = range && offsetsWithin(element, range);
		if (!range || !offsets) {
			pending = undefined;
			return;
		}
		const rect = range.getBoundingClientRect();
		const box = wrapper.getBoundingClientRect();
		const below = rect.top - box.top < POPUP_ROOM;
		pending = {
			quote: quoteAt(element.textContent ?? "", offsets.start, offsets.end),
			x: Math.min(Math.max(rect.left - box.left + rect.width / 2, 0), box.width),
			y: below ? rect.bottom - box.top : rect.top - box.top,
			below,
		};
	}

	// a deselect anywhere in the page, not only in this field, takes the popup down
	function dropStaleSelection() {
		if (!pending || !element) return;
		const range = selectedRange();
		if (!range || !offsetsWithin(element, range)) pending = undefined;
	}

	function comment() {
		if (!pending || !oncomment) return;
		const { quote } = pending;
		pending = undefined;
		oncomment(quote);
	}
</script>

<svelte:document onselectionchange={dropStaleSelection} />

<div bind:this={wrapper} class="relative min-w-0">
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
	{#if pending}
		<button
			type="button"
			class="absolute z-20 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs whitespace-nowrap text-gray-700 shadow-md hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
			style="left: {pending.x}px; top: {pending.y}px; transform: translate(-50%, {pending.below
				? '6px'
				: 'calc(-100% - 6px)'});"
			data-selection-popup
			onmousedown={(e) => e.preventDefault()}
			onclick={comment}
		>
			<CarbonAddComment class="text-xs" />
			Comment on selection
		</button>
	{/if}
</div>
