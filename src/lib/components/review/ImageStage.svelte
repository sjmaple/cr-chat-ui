<script lang="ts">
	import { imageUrl } from "$lib/utils/review/view";

	import CarbonZoomIn from "~icons/carbon/zoom-in";
	import CarbonZoomOut from "~icons/carbon/zoom-out";
	import CarbonLaunch from "~icons/carbon/launch";

	interface Props {
		value: unknown;
	}

	let { value }: Props = $props();

	const ZOOMS = [1, 1.5, 2, 3];
	const STAGE_IMAGE_PX = 380;

	let src = $derived(typeof value === "string" ? imageUrl(value) : undefined);
	let zoom = $state(0);
	let size = $state<{ w: number; h: number } | undefined>(undefined);
	let failed = $state(false);
	let name = $derived(typeof value === "string" ? (value.split("/").at(-1) ?? value) : "");
</script>

<div
	class="relative flex h-[420px] flex-none items-center justify-center overflow-auto bg-gray-100 dark:bg-gray-950"
	data-image-stage
>
	{#if src && !failed}
		<img
			{src}
			alt={name}
			class={[
				"shadow-[0_2px_12px_rgba(0,0,0,0.12)]",
				zoom === 0 && "max-h-[380px] max-w-[calc(100%-32px)] object-contain",
			]}
			style={zoom > 0 ? `height: ${STAGE_IMAGE_PX * (ZOOMS.at(zoom) ?? 1)}px; max-width: none` : ""}
			onload={(e) => {
				const img = e.currentTarget as HTMLImageElement;
				size = { w: img.naturalWidth, h: img.naturalHeight };
			}}
			onerror={() => (failed = true)}
		/>
	{:else}
		<span class="px-8 font-mono text-xs break-all text-gray-500 dark:text-gray-400">
			{String(value ?? "")}{failed ? " (could not load)" : ""}
		</span>
	{/if}
	<div
		class="absolute top-3 right-3 flex items-center gap-0.5 rounded-[10px] bg-gray-900/85 p-[3px] text-gray-200"
	>
		<button
			type="button"
			class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10 disabled:opacity-40"
			aria-label="Zoom out"
			disabled={zoom === 0}
			onclick={() => (zoom = Math.max(0, zoom - 1))}
		>
			<CarbonZoomOut />
		</button>
		<span class="min-w-11 text-center font-mono text-xs">
			{zoom === 0 ? "Fit" : `${ZOOMS.at(zoom)}×`}
		</span>
		<button
			type="button"
			class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10 disabled:opacity-40"
			aria-label="Zoom in"
			disabled={zoom === ZOOMS.length - 1}
			onclick={() => (zoom = Math.min(ZOOMS.length - 1, zoom + 1))}
		>
			<CarbonZoomIn />
		</button>
		{#if src}
			<span class="mx-0.5 h-[18px] w-px bg-white/20"></span>
			<a
				class="inline-flex size-8 items-center justify-center rounded-[7px] hover:bg-white/10"
				href={src}
				target="_blank"
				rel="noreferrer"
				aria-label="Open original"
			>
				<CarbonLaunch />
			</a>
		{/if}
	</div>
	<div class="absolute bottom-2.5 left-3 font-mono text-[11.5px] text-gray-500 dark:text-gray-400">
		{#if size}{size.w} × {size.h} ·
		{/if}{name}
	</div>
</div>
