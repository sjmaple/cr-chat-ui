<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";

	interface Props {
		session: ReviewSession;
		/** what the footer counts, examples rows or images */
		noun: string;
		onfinish: () => void;
	}

	let { session, noun, onfinish }: Props = $props();

	let noteOpen = $state(false);
	let commented = $derived(
		Object.values(session.drafts).filter((draft) => draft.comments.length > 0).length
	);
	let comments = $derived(session.counts.comments);
	let blocked = $derived(session.blockers.length > 0);
	let changesFirst = $derived(comments > 0);

	const plain =
		"h-9 rounded-[9px] border border-gray-200 px-3.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800";
	const primary =
		"h-9 rounded-[9px] bg-gray-900 px-3.5 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white";
</script>

{#if session.editable}
	{#if noteOpen}
		<div class="flex-none border-t border-gray-200 px-4 pt-3 dark:border-gray-800">
			<textarea
				rows="2"
				bind:value={session.summary}
				maxlength={4000}
				aria-label="Note to the agent"
				placeholder="A note for the agent, sent with your verdict"
				class="scrollbar-custom w-full resize-y rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
			></textarea>
		</div>
	{/if}
	{#if session.submitError}
		<p class="m-0 flex-none px-4 pt-2 text-[13px] text-red-600 dark:text-red-400" role="alert">
			{session.submitError}
		</p>
	{/if}
	<footer
		class="flex flex-none items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800"
		data-review-footer
	>
		<div class="min-w-0 flex-1 truncate text-[13px] text-gray-500 dark:text-gray-400">
			{#if comments > 0}
				<b class="font-semibold text-gray-900 dark:text-gray-100">
					{comments} comment{comments === 1 ? "" : "s"}
				</b>
				on {commented}
				{commented === 1 ? noun.replace(/s$/, "") : noun}
			{:else}
				No comments yet
			{/if}
		</div>
		{#if blocked}
			<button type="button" class={primary} onclick={onfinish}>Finish</button>
		{:else}
			<button
				type="button"
				class="h-9 rounded-[9px] px-3 text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				aria-expanded={noteOpen}
				onclick={() => (noteOpen = !noteOpen)}
			>
				{noteOpen ? "Hide note" : "Add a note"}
			</button>
			<button
				type="button"
				class={changesFirst ? plain : primary}
				disabled={session.submitting}
				onclick={() => session.submit("approve")}
			>
				Approve
			</button>
			<button
				type="button"
				class={changesFirst ? primary : plain}
				disabled={session.submitting}
				onclick={() => session.submit("request_changes")}
			>
				Request changes
			</button>
		{/if}
	</footer>
{/if}
