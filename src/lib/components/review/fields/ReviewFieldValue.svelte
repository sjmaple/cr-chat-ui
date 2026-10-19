<script lang="ts">
	import type { ReviewField, ReviewQuote } from "$lib/types/MlReview";
	import type { AnchoredQuote } from "../quoteAnchors";
	import ChatField from "./ChatField.svelte";
	import CodeField from "./CodeField.svelte";
	import ImageField from "./ImageField.svelte";
	import JsonField from "./JsonField.svelte";
	import TextField from "./TextField.svelte";

	interface Props {
		field: ReviewField;
		value: unknown;
		clamp?: boolean;
		quotes?: AnchoredQuote[];
		onanchors?: (lost: string[]) => void;
		onselect?: (quote: ReviewQuote | undefined) => void;
	}

	let { field, value, clamp = false, quotes, onanchors, onselect }: Props = $props();
</script>

{#if value === undefined || value === null}
	<span class="text-sm text-gray-300 dark:text-gray-600">—</span>
{:else if field.type === "text" || field.type === "markdown"}
	<TextField
		value={String(value)}
		markdown={field.type === "markdown"}
		{clamp}
		{quotes}
		{onanchors}
		{onselect}
	/>
{:else if field.type === "code"}
	<CodeField value={String(value)} language={field.language} {clamp} />
{:else if field.type === "json"}
	<JsonField {value} {clamp} />
{:else if field.type === "chat"}
	<ChatField value={value as { role: string; content: string }[]} {clamp} />
{:else if field.type === "image"}
	<ImageField value={String(value)} {clamp} />
{:else}
	<span
		class="inline-flex max-w-full items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
	>
		<span class="truncate">{String(value)}</span>
	</span>
{/if}
