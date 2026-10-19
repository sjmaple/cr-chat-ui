<script lang="ts">
	import { tick } from "svelte";
	import { page } from "$app/state";
	import { mlReviews, type ReviewSession } from "$lib/stores/mlReview.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type {
		ReviewDraft,
		ReviewField,
		ReviewQuestion,
		ReviewRecord,
		ReviewVerdict,
	} from "$lib/types/MlReview";
	import { useIsDesktop } from "$lib/utils/isDesktop.svelte";
	import { formatFileRef } from "$lib/utils/mlRegistry";
	import { isAnswered } from "$lib/utils/review/answers";
	import { keyOptions, pick, suggestionVisible } from "$lib/utils/review/view";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import SidePane from "./SidePane.svelte";
	import ImageField from "../review/fields/ImageField.svelte";
	import ReviewRecordView from "../review/ReviewRecordView.svelte";

	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonFocus from "~icons/carbon/center-to-fit";
	import CarbonList from "~icons/carbon/list";
	import CarbonHelp from "~icons/carbon/help";

	const VERDICTS: { value: ReviewVerdict; label: string; hint: string }[] = [
		{ value: "approve", label: "Approve", hint: "The data is good to use" },
		{ value: "request_changes", label: "Request changes", hint: "Fix what the comments say" },
		{ value: "comment", label: "Comment", hint: "Feedback without a decision" },
	];
	const VERDICT_LABEL: Record<ReviewVerdict, string> = {
		approve: "Approved",
		request_changes: "Changes requested",
		comment: "Commented",
	};
	const KEYS: [string, string][] = [
		["1–9", "Pick an option of the highlighted question"],
		["J / K", "Next / previous record"],
		["Enter", "Next unanswered record"],
		["C", "Comment on the record"],
		["A", "Accept the model's suggestion"],
		["S", "Skip the record"],
		["?", "Show or hide these keys"],
		["Esc", "Close this list"],
	];

	const isDesktop = useIsDesktop();
	const uid = $props.id();

	let reviewId = $derived(sidePane.reviewId);
	let showing = $derived(sidePane.open && sidePane.view === "review" && !!reviewId);
	let conversationId = $derived(page.params?.id);

	$effect(() => {
		if (showing && conversationId && reviewId) mlReviews.ensure(conversationId, reviewId);
	});

	let session = $derived(showing ? mlReviews.get(reviewId) : undefined);
	let schema = $derived(session?.schema);
	let records = $derived(session?.records ?? []);
	let status = $derived(session?.payload?.status);
	let view = $derived(
		session?.view ?? (session?.labelling || !isDesktop.current ? "focus" : "list")
	);
	let focus = $derived(Math.min(session?.focus ?? 0, Math.max(0, records.length - 1)));
	let keyable = $derived((schema?.questions ?? []).filter((question) => question.type !== "text"));

	let chosenQuestion = $state<string | undefined>(undefined);
	let composeNonce = $state(0);
	let helpOpen = $state(false);
	let drawer = $state<"blockers" | "comments" | "finish" | undefined>(undefined);
	let instructionsOpen = $state(true);

	let activeQuestion = $derived.by(() => {
		if (chosenQuestion && keyable.some((question) => question.name === chosenQuestion)) {
			return chosenQuestion;
		}
		const answers = session?.draft(focus)?.answers ?? {};
		return (keyable.find((question) => !isAnswered(answers[question.name])) ?? keyable[0])?.name;
	});

	let allComments = $derived.by(() => {
		const list: { index: number; id: string; field?: string; body: string; record: string }[] = [];
		for (const [key, draft] of Object.entries(session?.drafts ?? {})) {
			const index = Number(key);
			for (const comment of draft.comments) {
				list.push({
					index,
					id: comment.id,
					field: comment.field,
					body: comment.body,
					record: records[index]?.id ?? String(index + 1),
				});
			}
		}
		return list.sort((a, b) => a.index - b.index);
	});

	let saveLabel = $derived.by(() => {
		if (!session?.editable) return undefined;
		if (session.saveErrors.size > 0) return "Not saved";
		if (session.saving > 0) return "Saving…";
		return Object.keys(session.drafts).length > 0 ? "Saved" : undefined;
	});

	function setView(next: "list" | "focus") {
		if (session) session.view = next;
	}

	function goTo(index: number, question?: string) {
		if (!session) return;
		session.view = "focus";
		session.focus = Math.max(0, Math.min(index, records.length - 1));
		chosenQuestion = question;
	}

	function move(step: number) {
		goTo(focus + step);
	}

	function nextUnanswered() {
		if (!session) return;
		for (let n = 1; n <= records.length; n += 1) {
			const index = (focus + n) % records.length;
			const draftStatus = session.draft(index)?.status ?? "pending";
			if (draftStatus === "pending") {
				goTo(index);
				return;
			}
		}
		drawer = "finish";
	}

	async function showComment(index: number, id: string) {
		goTo(index);
		drawer = undefined;
		await tick();
		document.getElementById(`review-comment-${id}`)?.scrollIntoView({ block: "center" });
	}

	function answerByKey(question: ReviewQuestion, n: number) {
		if (!session) return;
		const option = keyOptions(question)[n - 1];
		if (!option) return;
		const current = session.draft(focus)?.answers[question.name];
		const next = pick(question, current, option.value);
		session.setAnswer(
			focus,
			question.name,
			Array.isArray(next) && next.length === 0 ? undefined : next
		);
		if (question.type === "multi_label") return;
		const answers = session.draft(focus)?.answers ?? {};
		const at = keyable.findIndex((candidate) => candidate.name === question.name);
		const after = [...keyable.slice(at + 1), ...keyable.slice(0, at)].find(
			(candidate) => !isAnswered(answers[candidate.name])
		);
		chosenQuestion = after?.name ?? question.name;
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

	function onkeydown(e: KeyboardEvent) {
		if (!showing || !session?.payload || e.defaultPrevented) return;
		if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
		if (e.key === "Escape" && (helpOpen || drawer)) {
			e.preventDefault();
			helpOpen = false;
			drawer = undefined;
			return;
		}
		if (e.key === "?") {
			e.preventDefault();
			helpOpen = !helpOpen;
			return;
		}
		if (view !== "focus" || records.length === 0) return;
		const key = e.key.toLowerCase();
		const question = keyable.find((candidate) => candidate.name === activeQuestion);
		if (/^[1-9]$/.test(e.key)) {
			if (!question || !session.editable) return;
			e.preventDefault();
			answerByKey(question, Number(e.key));
		} else if (key === "j") {
			e.preventDefault();
			move(1);
		} else if (key === "k") {
			e.preventDefault();
			move(-1);
		} else if (key === "c") {
			if (!session.editable) return;
			e.preventDefault();
			composeNonce += 1;
		} else if (key === "a") {
			if (!question || !session.editable) return;
			const suggestion = records[focus]?.suggestions?.[question.name];
			const current = session.draft(focus)?.answers[question.name];
			if (!suggestion || !suggestionVisible(schema?.suggestions ?? "none", current)) return;
			e.preventDefault();
			session.setAnswer(focus, question.name, suggestion.value);
		} else if (key === "s") {
			if (!session.editable) return;
			e.preventDefault();
			session.skip(focus);
			move(1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			nextUnanswered();
		}
	}

	function flushOnHide() {
		if (document.visibilityState === "hidden") void mlReviews.flushAll({ keepalive: true });
	}

	async function submit(target: ReviewSession) {
		if (await target.submit(target.chosenVerdict)) drawer = undefined;
	}

	function dotClass(draft: ReviewDraft | undefined, current: boolean) {
		const tone =
			draft?.status === "answered"
				? "bg-green-500"
				: draft?.status === "skipped" || draft?.status === "discarded"
					? "bg-amber-400"
					: "bg-gray-200 dark:bg-gray-700";
		const ring = current
			? "ring-2 ring-gray-800 ring-offset-1 dark:ring-gray-200 dark:ring-offset-gray-900"
			: draft?.comments.length
				? "ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900"
				: "";
		return `${tone} ${ring}`;
	}

	function statusText(draft: ReviewDraft | undefined) {
		return draft?.status === "answered"
			? "answered"
			: draft?.status === "skipped" || draft?.status === "discarded"
				? "skipped"
				: "not answered";
	}

	function preview(field: ReviewField, value: unknown): string {
		if (value === undefined || value === null) return "—";
		switch (field.type) {
			case "json":
				return JSON.stringify(value).slice(0, 300);
			case "chat":
				return (value as { role: string; content: string }[])
					.slice(0, 2)
					.map((turn) => `${turn.role}: ${turn.content}`)
					.join("\n");
			default:
				return String(value);
		}
	}

	const previewFields = (fields: ReviewField[]) => fields.slice(0, 3);
	const questionTitle = (name: string) => {
		const question = schema?.questions.find((candidate) => candidate.name === name);
		return question?.title ?? name;
	};
</script>

<svelte:window {onkeydown} onbeforeunload={() => void mlReviews.flushAll({ keepalive: true })} />
<svelte:document onvisibilitychange={flushOnHide} />

{#snippet listRow(record: ReviewRecord, index: number)}
	{@const draft = session?.draft(index)}
	{@const expanded = session?.expanded.has(index)}
	<li class="border-b border-gray-100 dark:border-gray-800" data-row={index}>
		<div class="flex items-start gap-2 px-3 py-2">
			<button
				type="button"
				class="flex min-w-0 flex-1 items-start gap-2.5 text-left"
				aria-expanded={expanded}
				onclick={() => {
					if (!session) return;
					if (session.expanded.has(index)) session.expanded.delete(index);
					else session.expanded.add(index);
				}}
			>
				<span
					class="mt-1.5 size-2 flex-none rounded-full {dotClass(draft, false)}"
					aria-label={statusText(draft)}
				></span>
				<span class="w-20 flex-none truncate font-mono text-xs text-gray-500 dark:text-gray-400">
					{record.id}
				</span>
				{#if !expanded && schema}
					<span class="grid min-w-0 flex-1 gap-1">
						{#each previewFields(schema.fields) as field (field.name)}
							{#if field.type === "image" && typeof record.values[field.name] === "string"}
								<ImageField value={record.values[field.name] as string} clamp />
							{:else}
								<span
									class="line-clamp-2 text-xs break-words whitespace-pre-wrap text-gray-700 dark:text-gray-300"
								>
									{preview(field, record.values[field.name])}
								</span>
							{/if}
						{/each}
					</span>
				{:else}
					<span class="flex-1"></span>
				{/if}
				{#if draft?.comments.length}
					<span
						class="flex-none rounded-full bg-blue-50 px-1.5 text-[11px] text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
					>
						{draft.comments.length}
					</span>
				{/if}
			</button>
			<button
				type="button"
				class="flex-none rounded-sm p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
				aria-label="Open record {record.id} in the focus view"
				title="Focus view"
				onclick={() => goTo(index)}
			>
				<CarbonFocus class="text-xs" />
			</button>
		</div>
		{#if expanded && session}
			<div class="px-3 pt-1 pb-4 pl-8">
				<ReviewRecordView {session} {index} />
			</div>
		{/if}
	</li>
{/snippet}

{#if showing}
	<SidePane label="Review" escapeDisabled={helpOpen || drawer !== undefined}>
		<header
			class="@container relative z-10 flex flex-none flex-col border-b border-gray-100 dark:border-gray-800"
		>
			<div class="flex h-12 items-center gap-2 px-3">
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
						{schema?.title ?? "Review"}
					</h2>
					{#if saveLabel}
						<span
							class={[
								"hidden flex-none text-xs @min-[360px]:inline",
								saveLabel === "Not saved" ? "text-red-600" : "text-gray-400 dark:text-gray-500",
							]}
							role="status"
						>
							{saveLabel}
						</span>
					{/if}
				</div>
				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					{#if session?.payload}
						<div class="mr-1 flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
							<button
								type="button"
								class={[
									"rounded-sm p-1 text-xs",
									view === "list" &&
										"bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
								]}
								aria-label="List view"
								aria-pressed={view === "list"}
								onclick={() => setView("list")}
							>
								<CarbonList />
							</button>
							<button
								type="button"
								class={[
									"rounded-sm p-1 text-xs",
									view === "focus" &&
										"bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
								]}
								aria-label="Focus view"
								aria-pressed={view === "focus"}
								onclick={() => setView("focus")}
							>
								<CarbonFocus />
							</button>
						</div>
					{/if}
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						aria-label="Keyboard shortcuts"
						title="Keyboard shortcuts (?)"
						onclick={() => (helpOpen = !helpOpen)}
					>
						<CarbonHelp />
					</button>
					<button
						type="button"
						class="ml-0.5 btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Close panel (Esc)"
						aria-label="Close panel"
						onclick={() => sidePane.close()}
					>
						<CarbonCloseLarge />
					</button>
				</div>
			</div>

			{#if session?.payload && schema}
				<div class="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-xs">
					{#if schema.instructions}
						<button
							type="button"
							class="rounded-md px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
							aria-expanded={instructionsOpen}
							onclick={() => (instructionsOpen = !instructionsOpen)}
						>
							Instructions
						</button>
					{/if}
					{#if schema.questions.length > 0}
						<span class="text-gray-500 tabular-nums dark:text-gray-400">
							{session.counts.answered} / {records.length} answered
						</span>
					{:else}
						<span class="text-gray-500 tabular-nums dark:text-gray-400">
							{records.length} records
						</span>
					{/if}
					<span class="flex-1"></span>
					<button
						type="button"
						class={[
							"rounded-md border px-1.5 py-0.5",
							session.blockers.length > 0
								? "border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-400"
								: "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400",
						]}
						aria-expanded={drawer === "blockers"}
						onclick={() => (drawer = drawer === "blockers" ? undefined : "blockers")}
					>
						Blockers ({session.blockers.length})
					</button>
					<button
						type="button"
						class="rounded-md border border-gray-200 px-1.5 py-0.5 text-gray-500 dark:border-gray-700 dark:text-gray-400"
						aria-expanded={drawer === "comments"}
						onclick={() => (drawer = drawer === "comments" ? undefined : "comments")}
					>
						Pending comments ({allComments.length})
					</button>
					{#if session.editable}
						<button
							type="button"
							class="rounded-md bg-black px-2 py-0.5 font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
							aria-expanded={drawer === "finish"}
							onclick={() => (drawer = drawer === "finish" ? undefined : "finish")}
						>
							Submit review
						</button>
					{/if}
				</div>

				{#if session.saveErrors.size > 0}
					<p
						class="border-t border-gray-100 px-3 py-1.5 text-xs text-red-600 dark:border-gray-800 dark:text-red-400"
						role="alert"
					>
						{[...session.saveErrors.values()][0]}
					</p>
				{/if}

				{#if schema.instructions && instructionsOpen}
					<div
						class="prose scrollbar-custom max-h-40 max-w-none overflow-y-auto border-t border-gray-100 px-3 py-2 text-xs dark:border-gray-800 dark:prose-invert"
					>
						<MarkdownRenderer content={schema.instructions} />
					</div>
				{/if}

				{#if drawer === "blockers"}
					<div
						class="scrollbar-custom max-h-56 overflow-y-auto border-t border-gray-100 px-3 py-2 dark:border-gray-800"
						role="region"
						aria-label="Blockers"
					>
						{#if session.blockers.length === 0}
							<p class="text-xs text-gray-500 dark:text-gray-400">Nothing blocks the submit.</p>
						{:else}
							<ul class="flex flex-col gap-0.5">
								{#each session.blockers.slice(0, 200) as blocker (`${blocker.record}:${blocker.question}`)}
									<li>
										<button
											type="button"
											class="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
											data-blocker="{blocker.record}:{blocker.question}"
											onclick={() => {
												goTo(blocker.record, blocker.question);
												drawer = undefined;
											}}
										>
											<span class="font-mono text-gray-500 dark:text-gray-400">
												{records[blocker.record]?.id ?? blocker.record + 1}
											</span>
											· {questionTitle(blocker.question)}: {blocker.reason}
										</button>
									</li>
								{/each}
							</ul>
							{#if session.blockers.length > 200}
								<p class="mt-1 text-xs text-gray-400">
									and {session.blockers.length - 200} more
								</p>
							{/if}
						{/if}
					</div>
				{:else if drawer === "comments"}
					<div
						class="scrollbar-custom max-h-56 overflow-y-auto border-t border-gray-100 px-3 py-2 dark:border-gray-800"
						role="region"
						aria-label="Pending comments"
					>
						{#if allComments.length === 0}
							<p class="text-xs text-gray-500 dark:text-gray-400">
								No comments yet. Press C in the focus view, or select text in a field.
							</p>
						{:else}
							<ul class="flex flex-col gap-0.5">
								{#each allComments as comment (comment.id)}
									<li>
										<button
											type="button"
											class="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
											onclick={() => showComment(comment.index, comment.id)}
										>
											<span class="font-mono text-gray-500 dark:text-gray-400">
												{comment.record}{comment.field ? ` · ${comment.field}` : ""}
											</span>
											· {comment.body}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else if drawer === "finish" && session.editable}
					{@const target = session}
					<div
						class="flex flex-col gap-2 border-t border-gray-100 px-3 py-2.5 dark:border-gray-800"
						role="region"
						aria-label="Finish your review"
					>
						<div class="flex flex-col gap-1" role="radiogroup" aria-label="Verdict">
							{#each VERDICTS as verdict (verdict.value)}
								<label class="flex cursor-pointer items-baseline gap-2 text-xs">
									<input
										type="radio"
										name="review-verdict-{uid}"
										value={verdict.value}
										checked={target.chosenVerdict === verdict.value}
										onchange={() => (target.verdict = verdict.value)}
									/>
									<span class="font-medium text-gray-700 dark:text-gray-200">{verdict.label}</span>
									<span class="text-gray-400 dark:text-gray-500">{verdict.hint}</span>
								</label>
							{/each}
						</div>
						<textarea
							bind:value={target.summary}
							class="scrollbar-custom min-h-14 w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
							placeholder="Summary for the intern (optional)"
							aria-label="Summary"
							maxlength={4000}
						></textarea>
						{#if target.submitError}
							<p class="text-xs text-red-600 dark:text-red-400" role="alert">
								{target.submitError}
							</p>
						{/if}
						<div class="flex items-center justify-end gap-2">
							{#if target.blockers.length > 0}
								<span class="text-xs text-red-600 dark:text-red-400">
									{target.blockers.length} blocker{target.blockers.length === 1 ? "" : "s"} left
								</span>
							{/if}
							<button
								type="button"
								class="btn rounded-md bg-black px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
								disabled={target.blockers.length > 0 || target.submitting}
								onclick={() => submit(target)}
							>
								{target.submitting ? "Submitting…" : "Submit"}
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</header>

		<div
			class="relative scrollbar-custom min-h-0 flex-1 overflow-y-auto bg-white text-sm dark:bg-gray-900"
		>
			{#if !session || session.load === "loading"}
				<p class="p-4 text-xs text-gray-500" role="status">Loading…</p>
			{:else if session.load === "missing"}
				<p class="p-4 text-xs text-gray-500">This review is no longer available.</p>
			{:else if session.load === "error"}
				<p class="p-4 text-xs text-gray-500">
					Could not load the review.
					<button type="button" class="underline" onclick={() => session?.refresh()}>Retry</button>
				</p>
			{:else if session.payload && schema}
				{#if status === "submitted"}
					<div
						class="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300"
						role="status"
					>
						<span class="font-medium">
							Submitted · {VERDICT_LABEL[session.payload.verdict ?? "comment"]}
						</span>
						{#each session.payload.result?.files ?? [] as file (`${file.name}@${file.version}`)}
							<button
								type="button"
								class="font-mono underline decoration-gray-300 hover:text-gray-900 dark:hover:text-white"
								onclick={() => sidePane.openRegistry(file)}
							>
								{formatFileRef(file)}
							</button>
						{/each}
					</div>
				{:else if status === "expired"}
					<p
						class="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300"
						role="status"
					>
						This review expired before it was submitted.
					</p>
				{:else if status === "detached"}
					<p
						class="border-b border-gray-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-gray-800 dark:bg-amber-500/10 dark:text-amber-200"
						role="status"
					>
						The chat moved on. Your drafts are kept, and submitting sends the review as a message.
					</p>
				{/if}

				{#if view === "list"}
					<ul aria-label="Records">
						{#each records as record, index (index)}
							{@render listRow(record, index)}
						{/each}
					</ul>
				{:else if records[focus]}
					{@const record = records[focus]}
					<div class="flex flex-col gap-3 px-3 py-3">
						<div
							class="scrollbar-custom flex max-h-16 flex-wrap gap-1 overflow-y-auto p-0.5"
							aria-label="Records"
							role="group"
						>
							{#each records as each, index (index)}
								{@const draft = session.draft(index)}
								<button
									type="button"
									class="size-2.5 rounded-full {dotClass(draft, index === focus)}"
									aria-label="Record {index + 1}: {each.id}, {statusText(draft)}"
									aria-current={index === focus ? "true" : undefined}
									onclick={() => goTo(index)}
								></button>
							{/each}
						</div>
						<div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
							<button
								type="button"
								class="rounded-sm p-0.5 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
								aria-label="Previous record"
								disabled={focus === 0}
								onclick={() => move(-1)}
							>
								<CarbonChevronLeft />
							</button>
							<span class="tabular-nums" data-focus-position>
								{focus + 1} / {records.length}
							</span>
							<span class="min-w-0 truncate font-mono text-gray-700 dark:text-gray-300">
								{record.id}
							</span>
							<button
								type="button"
								class="rounded-sm p-0.5 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
								aria-label="Next record"
								disabled={focus >= records.length - 1}
								onclick={() => move(1)}
							>
								<CarbonChevronRight />
							</button>
							<span class="flex-1"></span>
							<span class="inline-block first-letter:uppercase"
								>{statusText(session.draft(focus))}</span
							>
							{#if session.editable}
								<button
									type="button"
									class="rounded-md border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
									onclick={() => {
										session?.skip(focus);
										move(1);
									}}
								>
									Skip
								</button>
							{/if}
						</div>
						{#key focus}
							<ReviewRecordView
								{session}
								index={focus}
								{activeQuestion}
								onactivequestion={(name) => (chosenQuestion = name)}
								{composeNonce}
							/>
						{/key}
						{#if session.editable}
							<p class="text-[11px] text-gray-400 dark:text-gray-500">
								1–9 pick · J/K next/previous · Enter next unanswered · C comment · A accept · S skip
								· ? keys
							</p>
						{/if}
					</div>
				{/if}
			{/if}

			{#if helpOpen}
				<div
					class="absolute inset-x-3 top-3 z-20 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800"
					role="dialog"
					aria-label="Keyboard shortcuts"
				>
					<p class="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">
						Keys, in the focus view
					</p>
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						{#each KEYS as [key, label] (key)}
							<dt><kbd class="font-mono text-gray-700 dark:text-gray-200">{key}</kbd></dt>
							<dd class="text-gray-500 dark:text-gray-400">{label}</dd>
						{/each}
					</dl>
					<p class="mt-2 text-[11px] text-gray-400">Keys are off while a text box has focus.</p>
				</div>
			{/if}
		</div>
	</SidePane>
{/if}
