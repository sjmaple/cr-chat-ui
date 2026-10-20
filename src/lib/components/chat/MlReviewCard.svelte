<script lang="ts">
	import { mlReviews } from "$lib/stores/mlReview.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type {
		MessageReviewRequestUpdate,
		MessageReviewResolvedUpdate,
	} from "$lib/types/MessageUpdate";
	import type { MlFileRef } from "$lib/types/MlFile";
	import type { ReviewVerdict } from "$lib/types/MlReview";
	import { formatFileRef } from "$lib/utils/mlRegistry";
	import { deliveryLabel } from "$lib/utils/review/view";

	import CarbonDataTable from "~icons/carbon/data-table";
	import CarbonCheckmarkFilled from "~icons/carbon/checkmark-filled";
	import CarbonWarningAlt from "~icons/carbon/warning-alt";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonDocument from "~icons/carbon/document";

	interface Props {
		request: MessageReviewRequestUpdate;
		resolved?: MessageReviewResolvedUpdate;
		conversationId: string;
		/** false on a share, which shows the submitted summary and nothing else */
		interactive: boolean;
	}

	let { request, resolved, conversationId, interactive }: Props = $props();

	const VERDICT_LABEL: Record<ReviewVerdict, string> = {
		approve: "Approved",
		request_changes: "Changes requested",
		comment: "Commented",
	};

	$effect(() => {
		if (interactive && conversationId && !resolved) {
			mlReviews.ensure(conversationId, request.reviewId);
		}
	});

	let session = $derived(interactive ? mlReviews.get(request.reviewId) : undefined);
	let status = $derived(resolved ? "submitted" : session?.payload?.status);
	let delivery = $derived(session?.payload?.delivery);
	let isOpen = $derived(
		sidePane.open && sidePane.view === "review" && sidePane.reviewId === request.reviewId
	);

	let frozen = $derived.by(() => {
		if (resolved) {
			return {
				verdict: resolved.verdict,
				answered: resolved.answered,
				skipped: resolved.skipped,
				comments: resolved.comments,
				files: resolved.files,
			};
		}
		if (session?.payload?.status !== "submitted") return undefined;
		return {
			verdict: session.payload.verdict ?? "comment",
			answered: session.counts.answered,
			skipped: session.counts.skipped,
			comments: session.counts.comments,
			files: session.payload.result?.files ?? [],
		};
	});

	let progress = $derived.by(() => {
		const comments = session?.counts.comments ?? 0;
		const commentText = `${comments} comment${comments === 1 ? "" : "s"}`;
		if (request.questions === 0) {
			return `${request.records} record${request.records === 1 ? "" : "s"} · ${commentText}`;
		}
		return `${session?.counts.answered ?? 0} / ${request.records} answered · ${commentText}`;
	});
	let fraction = $derived(
		request.records > 0 ? Math.min(1, (session?.counts.answered ?? 0) / request.records) : 0
	);

	function openFile(file: MlFileRef) {
		sidePane.openRegistry(file);
	}
</script>

<div
	data-exclude-from-copy
	class="my-2 flex w-full max-w-md flex-col gap-2.5 rounded-xl border bg-white px-3.5 py-3 shadow-xs has-[+.prose]:mb-4! dark:bg-gray-800/80 [.prose+&]:mt-4!
		{isOpen
		? 'border-blue-300 ring-1 ring-blue-300 dark:border-blue-500/30 dark:ring-blue-500/30'
		: 'border-gray-200 dark:border-gray-700'}"
	role="group"
	aria-label="Review: {request.title}"
>
	<div class="flex items-center gap-3">
		<div
			class="flex size-9 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700/70 dark:text-gray-300"
		>
			{#if frozen?.verdict === "approve"}
				<CarbonCheckmarkFilled class="text-base text-green-600 dark:text-green-500" />
			{:else if frozen?.verdict === "request_changes"}
				<CarbonWarningAlt class="text-base text-amber-600 dark:text-amber-500" />
			{:else if frozen}
				<CarbonChat class="text-base" />
			{:else}
				<CarbonDataTable class="text-base" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
				{request.title}
			</p>
			<p class="truncate text-xs text-gray-500 dark:text-gray-400">
				{#if frozen}
					{VERDICT_LABEL[frozen.verdict]} · {frozen.answered} answered{frozen.skipped
						? ` · ${frozen.skipped} skipped`
						: ""} · {frozen.comments} comment{frozen.comments === 1 ? "" : "s"}
				{:else}
					{request.records} record{request.records === 1 ? "" : "s"}{request.questions
						? ` · ${request.questions} question${request.questions === 1 ? "" : "s"}`
						: ""}
				{/if}
			</p>
		</div>
	</div>

	{#if frozen}
		{#if delivery}
			<p
				class={[
					"text-xs",
					delivery.status === "failed"
						? "text-red-600 dark:text-red-400"
						: "text-gray-500 dark:text-gray-400",
				]}
				data-delivery={delivery.status}
			>
				{deliveryLabel(delivery.status)}
			</p>
		{/if}
		{#if frozen.files.length}
			<div class="flex flex-wrap gap-1.5">
				{#each frozen.files as file (`${file.name}@${file.version}`)}
					<button
						type="button"
						class="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 font-mono text-xs text-gray-600 hover:border-gray-300 hover:text-gray-800 disabled:cursor-default disabled:hover:border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600"
						disabled={!interactive}
						title={interactive ? "Show in Resources" : undefined}
						onclick={() => openFile(file)}
					>
						<CarbonDocument class="flex-none text-[11px]" />
						<span class="truncate">{formatFileRef(file)}</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else if !interactive}
		<p class="text-xs text-gray-500 dark:text-gray-400">Not submitted.</p>
	{:else if session?.load === "missing" || session?.load === "error"}
		<p class="text-xs text-gray-500 dark:text-gray-400">
			{session.load === "missing"
				? "This review is no longer available."
				: "Could not load the review."}
		</p>
	{:else if status === "expired"}
		<p class="text-xs text-gray-500 dark:text-gray-400">
			This review expired before it was submitted.
		</p>
	{:else}
		<div class="flex flex-col gap-1">
			<p class="text-xs text-gray-600 tabular-nums dark:text-gray-300">
				{session?.load === "ready" ? progress : "Loading…"}
			</p>
			{#if request.questions > 0}
				<div
					class="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
					role="progressbar"
					aria-label="Records answered"
					aria-valuemin={0}
					aria-valuemax={request.records}
					aria-valuenow={session?.counts.answered ?? 0}
				>
					<div class="h-full bg-blue-500 transition-[width]" style="width: {fraction * 100}%"></div>
				</div>
			{/if}
			{#if status === "detached"}
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Still open. The chat moved on, so your submission arrives as a message.
				</p>
			{/if}
		</div>
		{#if session?.submitError}
			<p class="text-xs text-red-600 dark:text-red-400" role="alert">{session.submitError}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				class="btn rounded-lg bg-black px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
				onclick={() => sidePane.openReview(request.reviewId)}
			>
				Open review
			</button>
			{#if session?.editable && !session.labelling}
				<button
					type="button"
					class="btn rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
					disabled={session.submitting}
					onclick={() => session?.submit("approve")}
				>
					Approve all
				</button>
			{/if}
			{#if session?.editable && session.blockers.length === 0 && (session.labelling || session.counts.comments > 0)}
				<button
					type="button"
					class="btn rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
					disabled={session.submitting}
					onclick={() => session?.submit(session.chosenVerdict)}
				>
					{session.submitting ? "Submitting…" : "Submit"}
				</button>
			{/if}
		</div>
	{/if}
</div>
