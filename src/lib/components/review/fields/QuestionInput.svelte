<script lang="ts">
	import type {
		ReviewAnswer,
		ReviewQuestion,
		ReviewSuggestion,
		ReviewSuggestionsMode,
	} from "$lib/types/MlReview";
	import { isAnswered, validateAnswer } from "$lib/utils/review/answers";
	import { formatAnswer, keyOptions, pick, suggestionVisible } from "$lib/utils/review/view";

	interface Props {
		question: ReviewQuestion;
		value: ReviewAnswer | undefined;
		suggestion?: ReviewSuggestion;
		mode: ReviewSuggestionsMode;
		/** the question the number keys answer */
		active?: boolean;
		disabled?: boolean;
		onchange: (value: ReviewAnswer | undefined) => void;
		onactivate?: () => void;
	}

	let {
		question,
		value,
		suggestion,
		mode,
		active = false,
		disabled = false,
		onchange,
		onactivate,
	}: Props = $props();

	let options = $derived(keyOptions(question));
	let showSuggestion = $derived(!!suggestion && suggestionVisible(mode, value));
	let problem = $derived(isAnswered(value) ? validateAnswer(question, value) : undefined);
	let agrees = $derived(
		suggestion !== undefined &&
			isAnswered(value) &&
			JSON.stringify(suggestion.value) === JSON.stringify(value)
	);

	const selected = (option: ReviewAnswer) =>
		Array.isArray(value) ? value.includes(option as string) : value === option;

	function choose(option: ReviewAnswer) {
		const next = pick(question, value, option);
		if (question.type !== "multi_label" && value === option) onchange(undefined);
		else onchange(Array.isArray(next) && next.length === 0 ? undefined : next);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class={[
		"flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 transition-colors",
		active
			? "border-blue-300 bg-blue-50/40 dark:border-blue-500/40 dark:bg-blue-500/5"
			: "border-gray-100 dark:border-gray-800",
	]}
	data-question={question.name}
	data-active={active || undefined}
	onclick={onactivate}
>
	<div class="flex items-baseline gap-1.5">
		<span class="text-xs font-medium text-gray-700 dark:text-gray-200">
			{question.title ?? question.name}
		</span>
		{#if question.required}
			<span class="text-xs text-red-500" aria-label="required">*</span>
		{/if}
		{#if question.description}
			<span
				class="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500"
				title={question.description}
			>
				{question.description}
			</span>
		{/if}
	</div>

	{#if question.type === "text"}
		<textarea
			class="scrollbar-custom min-h-14 w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
			aria-label={question.title ?? question.name}
			maxlength={question.maxLength}
			{disabled}
			value={typeof value === "string" ? value : ""}
			oninput={(e) => onchange(e.currentTarget.value === "" ? undefined : e.currentTarget.value)}
		></textarea>
	{:else}
		<div
			class="flex flex-wrap gap-1"
			role={question.type === "multi_label" ? "group" : "radiogroup"}
		>
			{#each options as option, i (String(option.value))}
				<button
					type="button"
					class={[
						"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:cursor-default",
						selected(option.value)
							? "border-blue-500 bg-blue-500 text-white dark:border-blue-500"
							: "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600",
					]}
					role={question.type === "multi_label" ? undefined : "radio"}
					aria-checked={question.type === "multi_label" ? undefined : selected(option.value)}
					aria-pressed={question.type === "multi_label" ? selected(option.value) : undefined}
					{disabled}
					onclick={() => choose(option.value)}
				>
					{#if active && i < 9 && option.label !== String(i + 1)}
						<kbd class="font-mono text-[10px] opacity-60">{i + 1}</kbd>
					{/if}
					{option.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if showSuggestion && suggestion}
		<button
			type="button"
			class="inline-flex w-fit max-w-full items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700 disabled:cursor-default dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
			title={suggestion.rationale ?? "Accept the model's suggestion (A)"}
			data-suggestion
			{disabled}
			onclick={() => onchange(suggestion.value)}
		>
			<span class="truncate">
				model: {formatAnswer(question, suggestion.value)}{suggestion.score !== undefined
					? ` · ${suggestion.score.toFixed(2)}`
					: ""}
			</span>
			{#if agrees}
				<span class="text-green-600 dark:text-green-500">· agrees</span>
			{/if}
		</button>
	{/if}

	{#if problem}
		<p class="text-xs text-red-600 dark:text-red-400">{problem}</p>
	{/if}
</div>
