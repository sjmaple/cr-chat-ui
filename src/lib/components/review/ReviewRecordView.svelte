<script lang="ts">
	import { tick, untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewComment, ReviewQuestion, ReviewQuote } from "$lib/types/MlReview";
	import ReviewQuestions from "./ReviewQuestions.svelte";
	import ReviewFieldValue from "./fields/ReviewFieldValue.svelte";

	import CarbonAddComment from "~icons/carbon/add-comment";
	import CarbonTrashCan from "~icons/carbon/trash-can";

	interface Props {
		session: ReviewSession;
		index: number;
		/** the question the number keys answer, focus view only */
		activeQuestion?: string;
		onactivequestion?: (name: string) => void;
		/** bumped to open the record comment box, the C key */
		composeNonce?: number;
		/** the focus view shows the questions in its own dock, kept in view while the record scrolls */
		dockQuestions?: boolean;
	}

	let {
		session,
		index,
		activeQuestion,
		onactivequestion,
		composeNonce = 0,
		dockQuestions = false,
	}: Props = $props();

	let schema = $derived(session.schema);
	let record = $derived(session.records[index]);
	let draft = $derived(session.draft(index));
	let comments = $derived(draft?.comments ?? []);
	let editable = $derived(session.editable);

	let targeted = $derived.by(() => {
		const map = new Map<string, ReviewQuestion[]>();
		for (const question of schema?.questions ?? []) {
			if (!question.target) continue;
			map.set(question.target, [...(map.get(question.target) ?? []), question]);
		}
		return map;
	});
	let recordQuestions = $derived((schema?.questions ?? []).filter((question) => !question.target));

	const lost = new SvelteSet<string>();

	let composer = $state<{ field?: string; quote?: ReviewQuote } | undefined>(undefined);
	let composerText = $state("");
	let composerEl: HTMLTextAreaElement | undefined = $state();

	async function openComposer(target: { field?: string; quote?: ReviewQuote }) {
		if (!editable) return;
		composer = target;
		composerText = "";
		await tick();
		composerEl?.focus();
	}

	function saveComment() {
		const body = composerText.trim();
		if (!body || !composer) return;
		session.addComment(index, { ...composer, body });
		composer = undefined;
		composerText = "";
	}

	let lastNonce = untrack(() => composeNonce);
	$effect(() => {
		if (composeNonce > lastNonce) {
			lastNonce = composeNonce;
			void openComposer({});
		}
	});

	function anchorsFor(field: string) {
		return comments
			.filter((comment) => comment.field === field && comment.quote)
			.map((comment) => ({ id: comment.id, quote: comment.quote as ReviewQuote }));
	}

	function reportAnchors(field: string, ids: string[]) {
		for (const comment of comments) {
			if (comment.field !== field || !comment.quote) continue;
			if (ids.includes(comment.id)) lost.add(comment.id);
			else lost.delete(comment.id);
		}
	}
</script>

{#snippet commentList(list: ReviewComment[])}
	{#each list as comment (comment.id)}
		<div
			id="review-comment-{comment.id}"
			class="group/comment flex items-start gap-2 rounded-md border-l-2 border-amber-300 bg-amber-50/60 px-2 py-1.5 text-xs dark:border-amber-500/50 dark:bg-amber-500/5"
			data-comment={comment.id}
		>
			<div class="min-w-0 flex-1">
				{#if comment.quote}
					<p class="mb-0.5 truncate text-gray-500 italic dark:text-gray-400">
						“{comment.quote.exact}”
						{#if lost.has(comment.id)}
							<span
								class="ml-1 rounded-sm bg-gray-200 px-1 text-gray-600 not-italic dark:bg-gray-700 dark:text-gray-300"
								title="The quoted text is no longer in this field"
							>
								anchor lost
							</span>
						{/if}
					</p>
				{/if}
				<p class="break-words whitespace-pre-wrap text-gray-700 dark:text-gray-200">
					{comment.body}
				</p>
			</div>
			{#if editable}
				<button
					type="button"
					class="flex-none rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/comment:opacity-100 hover:text-red-600 focus:opacity-100"
					aria-label="Delete comment"
					onclick={() => session.removeComment(index, comment.id)}
				>
					<CarbonTrashCan class="text-xs" />
				</button>
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet composerBox(field: string | undefined)}
	{#if composer && composer.field === field}
		<div class="flex flex-col gap-1.5">
			{#if composer.quote}
				<p class="truncate text-xs text-gray-500 italic dark:text-gray-400">
					“{composer.quote.exact}”
				</p>
			{/if}
			<textarea
				bind:this={composerEl}
				bind:value={composerText}
				class="scrollbar-custom min-h-16 w-full resize-y scroll-mb-64 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
				placeholder="Leave a comment"
				aria-label="Comment"
				maxlength={2000}
				onkeydown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						composer = undefined;
					} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						saveComment();
					}
				}}
			></textarea>
			<div class="flex justify-end gap-1.5">
				<button
					type="button"
					class="btn rounded-md px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
					onclick={() => (composer = undefined)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn rounded-md bg-black px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
					disabled={!composerText.trim()}
					onclick={saveComment}
				>
					Add comment
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#if schema && record}
	<div class="flex flex-col gap-3" data-record={index}>
		{#each schema.fields as field (field.name)}
			{@const fieldComments = comments.filter((comment) => comment.field === field.name)}
			{@const quotable = field.type === "text" || field.type === "markdown"}
			<section class="group/field flex flex-col gap-1.5" data-field={field.name}>
				<div class="flex items-center gap-1.5">
					<h4
						class="text-[11px] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-500"
					>
						{field.title ?? field.name}
					</h4>
					{#if editable}
						<button
							type="button"
							class="rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/field:opacity-100 hover:text-gray-700 focus:opacity-100 dark:hover:text-gray-200"
							aria-label="Comment on {field.title ?? field.name}"
							title="Comment on this field"
							onclick={() => openComposer({ field: field.name })}
						>
							<CarbonAddComment class="text-xs" />
						</button>
					{/if}
				</div>
				<ReviewFieldValue
					{field}
					value={record.values[field.name]}
					quotes={quotable ? anchorsFor(field.name) : undefined}
					onanchors={(ids) => reportAnchors(field.name, ids)}
					oncomment={quotable && editable
						? (quote) => openComposer({ field: field.name, quote })
						: undefined}
				/>
				{#if !dockQuestions}
					<ReviewQuestions
						{session}
						{index}
						questions={targeted.get(field.name) ?? []}
						{activeQuestion}
						{onactivequestion}
					/>
				{/if}
				{@render commentList(fieldComments)}
				{@render composerBox(field.name)}
			</section>
		{/each}

		{#if !dockQuestions}
			<ReviewQuestions
				{session}
				{index}
				questions={recordQuestions}
				{activeQuestion}
				{onactivequestion}
			/>
		{/if}

		<div class="flex flex-col gap-1.5">
			{@render commentList(comments.filter((comment) => comment.field === undefined))}
			{@render composerBox(undefined)}
			{#if editable && !(composer && composer.field === undefined)}
				<button
					type="button"
					class="inline-flex w-fit items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
					onclick={() => openComposer({})}
				>
					<CarbonAddComment class="text-xs" />
					Comment on the record
				</button>
			{/if}
		</div>
	</div>
{/if}
