
const STAGES = [
	{
		layout: "kirtasiye",
		storeObject: "kirtasiye",
		buttonUid: 8,
		cardObject: "kirtasiye_secenekler",
		correctIndex: 0,
		problemAudio: "ProblemMetni1.webm",
		instructionAudio: "Yönerge1.webm"
	},
	{
		layout: "manav",
		storeObject: "manav",
		buttonUid: 9,
		cardObject: "manav_secenekler",
		correctIndex: 1,
		problemAudio: "ProblemMetni2.webm",
		instructionAudio: "Yönerge2.webm"
	},
	{
		layout: "terzi",
		storeObject: "terzi",
		buttonUid: 11,
		cardObject: "terzi_secenekler",
		correctIndex: 2,
		problemAudio: "ProblemMetni3.webm",
		instructionAudio: "Yönerge3.webm"
	},
	{
		layout: "market",
		storeObject: "market",
		buttonUid: 10,
		cardObject: "market_secenekler",
		correctIndex: 1,
		problemAudio: "ProblemMetni4.webm",
		instructionAudio: "Yönerge4.webm"
	}
];

const ANSWER_LABEL_FRAMES = [0, 3, 6];
const MAP_BLINK_INTERVAL = 0.45;
const ANSWER_FEEDBACK_SECONDS = 0.9;
const MUSIC_VOLUME = 0.42;
const MUSIC_DUCKED_VOLUME = 0.12;
const MUSIC_LOOP_START_SECONDS = 2.67;
const MUSIC_LOOP_END_SECONDS = 48.11;
const CONFETTI_FRAME_COUNT = 13;
const MENU_ANIMATION_SECONDS = 0.28;
const MENU_ITEM_STAGGER_SECONDS = 0.045;
const MENU_ITEM_NAMES = ["ses", "info", "ev"];
const HOVER_SCALE = 1.035;
const STAR_REWARD_BLINK_SECONDS = 0.9;
const STAR_REWARD_TRAVEL_SECONDS = 0.85;
const WRONG_THOUGHT_SECONDS = 1.5;
const WRONG_THOUGHT_WIDTH = 371;
const WRONG_THOUGHT_HEIGHT = 139;

let progress = 0;
let mapPulseStartedAt = 0;
let inputLocked = false;
let wrongAnswerResetAt = -1;
let pendingLayout = "";
let pendingLayoutAt = -1;
let currentAudioSource = null;
let currentAudioKind = "";
let currentAudioResolve = null;
let audioRequestId = 0;
let narrationLocked = false;
let narrationSequenceId = 0;
let musicSource = null;
let musicGainNode = null;
let musicStartPromise = null;
let isMusicDucked = false;
let isMusicMuted = false;
let musicRequestId = 0;
let endingConfettiAccumulator = 0;
let overflowMenuItems = [];
let overflowMenuOpen = false;
let overflowMenuAnimationStartedAt = -1;
let hoverTarget = null;
let hoverBaseWidth = 0;
let hoverBaseHeight = 0;
let hoverGlowInstances = [];
const hoverCloneInstances = new Set();
let starRewardAnimation = null;
let wrongThoughtAnimation = null;
const confettiPieces = [];
const audioBufferCache = new Map();

runOnStartup(async runtime =>
{
	runtime.addEventListener("beforeprojectstart", () => OnBeforeProjectStart(runtime));
});

async function OnBeforeProjectStart(runtime)
{
	runtime.addEventListener("afteranylayoutstart", event => OnLayoutStart(runtime, event.layout));
	runtime.addEventListener("pointerdown", event => OnPointerDown(runtime, event));
	runtime.addEventListener("pointermove", event => OnPointerMove(runtime, event));
	runtime.addEventListener("tick", () => Tick(runtime));
}

function OnLayoutStart(runtime, layout)
{
	narrationSequenceId++;
	narrationLocked = false;
	inputLocked = false;
	wrongAnswerResetAt = -1;
	pendingLayout = "";
	pendingLayoutAt = -1;
	StopAudio();
	CancelStarRewardAnimation();
	CancelWrongThoughtAnimation();
	confettiPieces.length = 0;
	endingConfettiAccumulator = 0;
	hoverTarget = null;
	hoverGlowInstances = [];
	hoverCloneInstances.clear();
	SetupOverflowMenu(runtime);
	runtime.mouse?.setCursorStyle("default");

	if (layout.name === "giris")
	{
		SetupMap(runtime);
		void StartBackgroundMusic(runtime);
		return;
	}

	const stageIndex = STAGES.findIndex(stage => stage.layout === layout.name);
	if (stageIndex !== -1)
	{
		SetupProblemLayout(runtime, stageIndex);
		return;
	}

	if (layout.name === "son")
	{
		SetupEndingConfetti(runtime);
		const replayButton = GetFirstInstance(runtime, "btn_tekrar");
		if (replayButton)
			replayButton.isVisible = false;
		void FinishEndingNarration(runtime);
	}
}

function SetupMap(runtime)
{
	mapPulseStartedAt = runtime.wallTime;

	for (let index = 0; index < STAGES.length; index++)
	{
		const stage = STAGES[index];
		const store = GetFirstInstance(runtime, stage.storeObject);
		const button = runtime.getInstanceByUid(stage.buttonUid);
		const completedFrame = index < progress ? 1 : 0;

		SetFrame(store, completedFrame);
		SetFrame(button, completedFrame);
	}

	const startLabel = GetFirstInstance(runtime, "basla");
	if (startLabel)
		startLabel.isVisible = progress === 0;

	SetFrame(GetFirstInstance(runtime, "ses"), isMusicMuted ? 1 : 0);

	const arrow = GetFirstInstance(runtime, "basla_ok");
	const activeButton = GetActiveMapButton(runtime);
	if (arrow && activeButton)
	{
		arrow.setPosition(activeButton.x + 134, activeButton.y + 48);
		arrow.isVisible = true;
	}

	UpdateMapHighlight(runtime);
}

function SetupProblemLayout(runtime, stageIndex)
{
	const stage = STAGES[stageIndex];
	const cards = GetSortedInstances(runtime, stage.cardObject);
	const labels = GetSortedInstances(runtime, "abc");

	for (const card of cards)
		card.stopAnimation();

	for (let index = 0; index < labels.length; index++)
	{
		labels[index].stopAnimation();
		labels[index].animationFrame = ANSWER_LABEL_FRAMES[index];
	}

	EnsureFourStarsOnMarket(runtime, stageIndex);
	ShowStars(runtime, stageIndex);
	EnsureThoughtObject(runtime);

	const speaker = GetFirstInstance(runtime, "ses");
	SetFrame(speaker, isMusicMuted ? 1 : 0);

	const problemButton = GetFirstInstance(runtime, "play");
	if (problemButton)
		problemButton.isVisible = false;

	void StartStageNarration(runtime, stageIndex);
}

function Tick(runtime)
{
	UpdateOverflowMenu(runtime);
	UpdateHoverEffect(runtime);
	UpdateStarRewardAnimation(runtime);
	UpdateWrongThoughtAnimation(runtime);
	UpdateConfetti(runtime);

	if (runtime.layout.name === "giris")
		UpdateMapHighlight(runtime);

	if (wrongAnswerResetAt >= 0 && runtime.wallTime >= wrongAnswerResetAt)
	{
		ResetAnswerLabels(runtime);
		wrongAnswerResetAt = -1;
	}

	if (pendingLayout && runtime.wallTime >= pendingLayoutAt)
	{
		const target = pendingLayout;
		pendingLayout = "";
		pendingLayoutAt = -1;
		if (runtime.layout.name === "son" && target === "giris")
		{
			progress = 0;
			isMusicMuted = false;
			StopBackgroundMusic();
		}
		runtime.goToLayout(target);
	}
}

function UpdateMapHighlight(runtime)
{
	if (progress < 0 || progress >= STAGES.length)
		return;

	const stage = STAGES[progress];
	const store = GetFirstInstance(runtime, stage.storeObject);
	const button = runtime.getInstanceByUid(stage.buttonUid);
	const elapsed = runtime.wallTime - mapPulseStartedAt;
	const blinkOn = Math.floor(elapsed / MAP_BLINK_INTERVAL) % 2 === 0;

	SetFrame(store, 1);
	SetFrame(button, blinkOn ? 1 : 0);

	const arrow = GetFirstInstance(runtime, "basla_ok");
	if (arrow)
		arrow.isVisible = blinkOn;
}

function OnPointerDown(runtime, event)
{
	if (event.pointerType === "mouse" && event.button !== 0)
		return;

	const layer = runtime.layout.getLayer(0);
	const [x, y] = layer.cssPxToLayer(event.clientX, event.clientY);

	if (HandleOverflowMenuPointer(runtime, x, y))
		return;

	if (HandleMusicButton(runtime, x, y))
		return;

	if (HandleInfoNavigation(runtime, x, y))
		return;

	if (!isMusicMuted)
	{
		void ResumeAudio(runtime);
		void StartBackgroundMusic(runtime);
	}

	if (runtime.layout.name === "giris")
	{
		HandleMapPointer(runtime, x, y);
		return;
	}

	if (runtime.layout.name === "son")
	{
		const replayButton = GetFirstInstance(runtime, "btn_tekrar");
		if (Hit(replayButton, x, y))
		{
			progress = 0;
			isMusicMuted = false;
			StopAudio();
			StopBackgroundMusic();
			ScheduleLayout(runtime, "giris", 0);
		}
		return;
	}

	const stageIndex = STAGES.findIndex(stage => stage.layout === runtime.layout.name);
	if (stageIndex !== -1)
		HandleProblemPointer(runtime, stageIndex, x, y);
}

async function FinishEndingNarration(runtime)
{
	await PlayAudio(runtime, "Seslendirme .webm", "ending");

	if (runtime.layout.name !== "son")
		return;

	const replayButton = GetFirstInstance(runtime, "btn_tekrar");
	if (replayButton)
		replayButton.isVisible = true;
}

function OnPointerMove(runtime, event)
{
	if (event.pointerType && event.pointerType !== "mouse")
		return;

	const layer = runtime.layout.getLayer(0);
	const [x, y] = layer.cssPxToLayer(event.clientX, event.clientY);
	const clickable = GetClickableInstanceAt(runtime, x, y);
	SetHoverTarget(clickable);
	const cursor = clickable ? "pointer" : "default";
	runtime.mouse?.setCursorStyle(cursor);
}

function SetupOverflowMenu(runtime)
{
	overflowMenuItems = [];
	overflowMenuOpen = false;
	overflowMenuAnimationStartedAt = -1;

	const menuButton = GetFirstInstance(runtime, "ucnokta");
	if (!menuButton)
		return;

	for (const objectName of MENU_ITEM_NAMES)
	{
		const instance = GetFirstInstance(runtime, objectName);
		if (!instance)
			continue;

		overflowMenuItems.push({
			instance,
			targetX: instance.x,
			targetY: instance.y,
			fromX: menuButton.x,
			fromY: menuButton.y,
			fromOpacity: 0,
			toX: menuButton.x,
			toY: menuButton.y,
			toOpacity: 0
		});

		instance.setPosition(menuButton.x, menuButton.y);
		instance.opacity = 0;
		instance.isVisible = false;
	}

	overflowMenuItems.sort((a, b) => a.targetY - b.targetY);
}

function HandleOverflowMenuPointer(runtime, x, y)
{
	const menuButton = GetFirstInstance(runtime, "ucnokta");
	if (!Hit(menuButton, x, y))
		return false;

	overflowMenuOpen = !overflowMenuOpen;
	overflowMenuAnimationStartedAt = runtime.wallTime;

	for (const item of overflowMenuItems)
	{
		const instance = item.instance;
		item.fromX = instance.x;
		item.fromY = instance.y;
		item.fromOpacity = instance.opacity;
		item.toX = overflowMenuOpen ? item.targetX : menuButton.x;
		item.toY = overflowMenuOpen ? item.targetY : menuButton.y;
		item.toOpacity = overflowMenuOpen ? 1 : 0;
		instance.isVisible = true;
	}

	return true;
}

function UpdateOverflowMenu(runtime)
{
	if (overflowMenuAnimationStartedAt < 0 || overflowMenuItems.length === 0)
		return;

	const elapsed = runtime.wallTime - overflowMenuAnimationStartedAt;
	let allFinished = true;

	for (let index = 0; index < overflowMenuItems.length; index++)
	{
		const item = overflowMenuItems[index];
		const order = overflowMenuOpen ? index : overflowMenuItems.length - index - 1;
		const delay = order * MENU_ITEM_STAGGER_SECONDS;
		const progress = Math.max(0, Math.min(1, (elapsed - delay) / MENU_ANIMATION_SECONDS));
		const eased = overflowMenuOpen
			? 1 - Math.pow(1 - progress, 3)
			: progress * progress * progress;

		item.instance.setPosition(
			Lerp(item.fromX, item.toX, eased),
			Lerp(item.fromY, item.toY, eased)
		);
		item.instance.opacity = Lerp(item.fromOpacity, item.toOpacity, eased);

		if (progress < 1)
			allFinished = false;
	}

	if (!allFinished)
		return;

	if (!overflowMenuOpen)
	{
		for (const item of overflowMenuItems)
			item.instance.isVisible = false;
	}

	overflowMenuAnimationStartedAt = -1;
}

function GetClickableInstanceAt(runtime, x, y)
{
	let instance = GetFirstInstance(runtime, "ucnokta");
	if (Hit(instance, x, y))
		return instance;

	instance = GetFirstInstance(runtime, "ses");
	if (Hit(instance, x, y))
		return instance;

	if (runtime.layout.name === "giris")
	{
		instance = GetFirstInstance(runtime, "info");
		if (Hit(instance, x, y))
			return instance;

		if (inputLocked || progress < 0 || progress >= STAGES.length)
			return null;

		const stage = STAGES[progress];
		const candidates = [
			GetFirstInstance(runtime, stage.storeObject),
			runtime.getInstanceByUid(stage.buttonUid),
			progress === 0 ? GetFirstInstance(runtime, "basla") : null,
			GetFirstInstance(runtime, "basla_ok")
		];
		return candidates.find(candidate => Hit(candidate, x, y)) ?? null;
	}

	if (runtime.layout.name === "son")
	{
		instance = GetFirstInstance(runtime, "btn_tekrar");
		return Hit(instance, x, y) ? instance : null;
	}

	if (runtime.layout.name === "info")
	{
		instance = GetFirstInstance(runtime, "ev");
		return Hit(instance, x, y) ? instance : null;
	}

	const stageIndex = STAGES.findIndex(stage => stage.layout === runtime.layout.name);
	if (stageIndex === -1)
		return null;

	instance = GetFirstInstance(runtime, "ev");
	if (Hit(instance, x, y))
		return instance;

	if (inputLocked)
		return null;

	instance = GetFirstInstance(runtime, "play");
	if (Hit(instance, x, y))
		return instance;

	if (narrationLocked)
		return null;

	const stage = STAGES[stageIndex];
	const cards = GetSortedInstances(runtime, stage.cardObject);
	const labels = GetSortedInstances(runtime, "abc");
	for (let index = 0; index < cards.length; index++)
	{
		if (Hit(cards[index], x, y))
			return cards[index];
		if (Hit(labels[index], x, y))
			return labels[index];
	}

	return null;
}

function SetHoverTarget(instance)
{
	if (hoverTarget === instance)
		return;

	ClearHoverEffect();
	if (!instance)
		return;

	hoverTarget = instance;
	hoverBaseWidth = instance.width;
	hoverBaseHeight = instance.height;
	instance.setSize(hoverBaseWidth * HOVER_SCALE, hoverBaseHeight * HOVER_SCALE);

	const objectType = instance.objectType;
	if (!objectType?.createInstance)
		return;

	let previousInstance = instance;
	for (let index = 0; index < 2; index++)
	{
		const glow = objectType.createInstance(instance.layer.name, instance.x, instance.y);
		glow.stopAnimation?.();
		if ("animationFrame" in glow && "animationFrame" in instance)
			glow.animationFrame = instance.animationFrame;
		glow.isCollisionEnabled = false;
		glow.colorRgb = [1, 0.88, 0.3];
		glow.blendMode = "additive";
		glow.opacity = index === 0 ? 0.18 : 0.09;
		glow.moveAdjacentToInstance(previousInstance, false);
		previousInstance = glow;
		hoverGlowInstances.push(glow);
		hoverCloneInstances.add(glow);
	}
}

function UpdateHoverEffect(runtime)
{
	if (!hoverTarget)
		return;

	const wave = (Math.sin(runtime.wallTime * 7) + 1) / 2;
	const targetScale = HOVER_SCALE + wave * 0.006;
	hoverTarget.setSize(hoverBaseWidth * targetScale, hoverBaseHeight * targetScale);

	for (let index = 0; index < hoverGlowInstances.length; index++)
	{
		const glow = hoverGlowInstances[index];
		const glowScale = (index === 0 ? 1.10 : 1.17) + wave * 0.015;
		glow.setPosition(hoverTarget.x, hoverTarget.y);
		glow.setSize(hoverBaseWidth * glowScale, hoverBaseHeight * glowScale);
		glow.angle = hoverTarget.angle;
		glow.isVisible = hoverTarget.isVisible;
		glow.opacity = (index === 0 ? 0.15 : 0.07) + wave * (index === 0 ? 0.08 : 0.04);
		if ("animationFrame" in glow && "animationFrame" in hoverTarget)
			glow.animationFrame = hoverTarget.animationFrame;
	}
}

function ClearHoverEffect()
{
	if (hoverTarget)
	{
		try
		{
			hoverTarget.setSize(hoverBaseWidth, hoverBaseHeight);
		}
		catch
		{
			// The previous layout may already have destroyed the instance.
		}
	}

	for (const glow of hoverGlowInstances)
	{
		hoverCloneInstances.delete(glow);
		try
		{
			glow.destroy();
		}
		catch
		{
			// The previous layout may already have destroyed the glow.
		}
	}

	hoverTarget = null;
	hoverGlowInstances = [];
}

function Lerp(start, end, amount)
{
	return start + (end - start) * amount;
}

function HandleMapPointer(runtime, x, y)
{
	if (inputLocked || progress < 0 || progress >= STAGES.length)
		return;

	const stage = STAGES[progress];
	const store = GetFirstInstance(runtime, stage.storeObject);
	const button = runtime.getInstanceByUid(stage.buttonUid);
	const startLabel = GetFirstInstance(runtime, "basla");
	const arrow = GetFirstInstance(runtime, "basla_ok");
	const clickedStartArea = progress === 0 && Hit(startLabel, x, y);

	if (Hit(store, x, y) || Hit(button, x, y) || clickedStartArea || Hit(arrow, x, y))
	{
		inputLocked = true;
		void StartBackgroundMusic(runtime);
		ScheduleLayout(runtime, stage.layout, 0);
	}
}

function HandleMusicButton(runtime, x, y)
{
	const speaker = GetFirstInstance(runtime, "ses");
	if (!Hit(speaker, x, y))
		return false;

	if (isMusicMuted)
	{
		isMusicMuted = false;
		SetFrame(speaker, 0);
		ApplyMusicVolume();
		void ResumeAudio(runtime);
		void StartBackgroundMusic(runtime);
	}
	else
	{
		isMusicMuted = true;
		SetFrame(speaker, 1);
		ApplyMusicVolume();
	}

	return true;
}

function HandleInfoNavigation(runtime, x, y)
{
	if (runtime.layout.name === "giris")
	{
		const infoButton = GetFirstInstance(runtime, "info");
		if (Hit(infoButton, x, y))
		{
			ScheduleLayout(runtime, "info", 0);
			return true;
		}
	}
	else if (runtime.layout.name === "info")
	{
		const homeButton = GetFirstInstance(runtime, "ev");
		if (Hit(homeButton, x, y))
		{
			ScheduleLayout(runtime, "giris", 0);
			return true;
		}
	}

	return false;
}

function HandleProblemPointer(runtime, stageIndex, x, y)
{
	const homeButton = GetFirstInstance(runtime, "ev");
	if (Hit(homeButton, x, y))
	{
		progress = 0;
		isMusicMuted = false;
		StopAudio();
		StopBackgroundMusic();
		ScheduleLayout(runtime, "giris", 0);
		return;
	}

	if (inputLocked)
		return;

	const problemButton = GetFirstInstance(runtime, "play");
	if (Hit(problemButton, x, y))
	{
		void ReplayProblemAudio(runtime, stageIndex);
		return;
	}

	if (narrationLocked)
		return;

	const stage = STAGES[stageIndex];
	const cards = GetSortedInstances(runtime, stage.cardObject);
	const labels = GetSortedInstances(runtime, "abc");

	for (let index = 0; index < cards.length; index++)
	{
		if (!Hit(cards[index], x, y) && !Hit(labels[index], x, y))
			continue;

		if (index === stage.correctIndex)
		{
			labels[index].animationFrame = ANSWER_LABEL_FRAMES[index] + 1;
			BurstConfetti(runtime, cards[index].x, cards[index].y);
			const starAnimation = StartStarRewardAnimation(runtime, stageIndex, cards[index]);
			progress = stageIndex + 1;
			inputLocked = true;
			StopAudio();
			void FinishCorrectAnswer(runtime, stageIndex, starAnimation);
		}
		else
		{
			labels[index].animationFrame = ANSWER_LABEL_FRAMES[index] + 2;
			const thoughtAnimation = StartWrongThoughtAnimation(runtime, cards[index]);
			inputLocked = true;
			StopAudio();
			void FinishWrongAnswer(runtime, stageIndex, thoughtAnimation);
		}

		return;
	}
}

async function FinishCorrectAnswer(runtime, stageIndex, starAnimation)
{
	await Promise.all([
		PlayAudio(runtime, "dogrucevap.webm", "feedback"),
		starAnimation
	]);

	if (runtime.layout.name !== STAGES[stageIndex].layout)
		return;

	ScheduleLayout(runtime, progress >= STAGES.length ? "son" : "giris", ANSWER_FEEDBACK_SECONDS);
}

async function FinishWrongAnswer(runtime, stageIndex, thoughtAnimation)
{
	await Promise.all([
		PlayAudio(runtime, "yanliscevap.webm", "feedback"),
		thoughtAnimation
	]);

	if (runtime.layout.name !== STAGES[stageIndex].layout)
		return;

	ResetAnswerLabels(runtime);
	wrongAnswerResetAt = -1;
	inputLocked = false;
}

async function StartStageNarration(runtime, stageIndex)
{
	const sequenceId = ++narrationSequenceId;
	const stage = STAGES[stageIndex];
	narrationLocked = true;

	const instructionCompleted = await PlayAudio(runtime, stage.instructionAudio, "instruction");

	if (!IsCurrentNarration(runtime, stageIndex, sequenceId))
		return;

	if (!instructionCompleted)
	{
		narrationLocked = false;
		return;
	}

	await Wait(1000);
	if (!IsCurrentNarration(runtime, stageIndex, sequenceId))
		return;

	await PlayAudio(runtime, stage.problemAudio, "problem");
	if (IsCurrentNarration(runtime, stageIndex, sequenceId))
	{
		narrationLocked = false;
		const problemButton = GetFirstInstance(runtime, "play");
		if (problemButton)
			problemButton.isVisible = true;
	}
}

async function ReplayProblemAudio(runtime, stageIndex)
{
	const sequenceId = ++narrationSequenceId;
	narrationLocked = true;
	await PlayAudio(runtime, STAGES[stageIndex].problemAudio, "problem");

	if (IsCurrentNarration(runtime, stageIndex, sequenceId))
		narrationLocked = false;
}

async function ReplayInstructionAudio(runtime, stageIndex)
{
	const sequenceId = ++narrationSequenceId;
	narrationLocked = true;
	await PlayAudio(runtime, STAGES[stageIndex].instructionAudio, "instruction");

	if (IsCurrentNarration(runtime, stageIndex, sequenceId))
		narrationLocked = false;
}

function IsCurrentNarration(runtime, stageIndex, sequenceId)
{
	return narrationSequenceId === sequenceId && runtime.layout.name === STAGES[stageIndex].layout;
}

function Wait(milliseconds)
{
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function EnsureFourStarsOnMarket(runtime, stageIndex)
{
	if (stageIndex !== 3)
		return;

	let stars = GetSortedInstances(runtime, "dolu_yildiz");
	while (stars.length < 4)
	{
		const star = runtime.objects.dolu_yildiz.createInstance("Layer 0", 267, 48);
		star.setSize(74, 67);
		stars = GetSortedInstances(runtime, "dolu_yildiz");
	}
}

function ShowStars(runtime, count)
{
	const stars = GetSortedInstances(runtime, "dolu_yildiz");
	for (let index = 0; index < stars.length; index++)
		stars[index].isVisible = index < count;
}

function StartStarRewardAnimation(runtime, stageIndex, answerCard)
{
	CancelStarRewardAnimation();

	const stars = GetSortedInstances(runtime, "dolu_yildiz");
	const star = stars[stageIndex];
	if (!star || !answerCard)
		return Promise.resolve(false);

	const destinationX = star.x;
	const destinationY = star.y;
	const destinationWidth = star.width;
	const destinationHeight = star.height;
	const startX = answerCard.x;
	const startY = Math.max(150, answerCard.y - answerCard.height / 2 - destinationHeight * 1.25);

	star.isVisible = true;
	star.opacity = 1;
	star.setPosition(startX, startY);
	star.setSize(destinationWidth * 1.6, destinationHeight * 1.6);
	star.moveToTop();

	return new Promise(resolve =>
	{
		starRewardAnimation = {
			star,
			startedAt: runtime.wallTime,
			startX,
			startY,
			destinationX,
			destinationY,
			destinationWidth,
			destinationHeight,
			resolve
		};
	});
}

function UpdateStarRewardAnimation(runtime)
{
	const animation = starRewardAnimation;
	if (!animation)
		return;

	const elapsed = runtime.wallTime - animation.startedAt;
	const star = animation.star;

	if (elapsed < STAR_REWARD_BLINK_SECONDS)
	{
		const pulse = (Math.sin(elapsed * 16) + 1) / 2;
		const scale = 1.55 + pulse * 0.16;
		star.setPosition(animation.startX, animation.startY - pulse * 10);
		star.setSize(
			animation.destinationWidth * scale,
			animation.destinationHeight * scale
		);
		star.opacity = Math.floor(elapsed / 0.13) % 2 === 0 ? 1 : 0.3;
		return;
	}

	const travelProgress = Math.min(1,
		(elapsed - STAR_REWARD_BLINK_SECONDS) / STAR_REWARD_TRAVEL_SECONDS);
	const eased = travelProgress < 0.5
		? 4 * travelProgress * travelProgress * travelProgress
		: 1 - Math.pow(-2 * travelProgress + 2, 3) / 2;

	star.opacity = 1;
	star.setPosition(
		Lerp(animation.startX, animation.destinationX, eased),
		Lerp(animation.startY, animation.destinationY, eased)
	);
	star.setSize(
		Lerp(animation.destinationWidth * 1.6, animation.destinationWidth, eased),
		Lerp(animation.destinationHeight * 1.6, animation.destinationHeight, eased)
	);

	if (travelProgress < 1)
		return;

	star.setPosition(animation.destinationX, animation.destinationY);
	star.setSize(animation.destinationWidth, animation.destinationHeight);
	starRewardAnimation = null;
	animation.resolve(true);
}

function CancelStarRewardAnimation()
{
	if (!starRewardAnimation)
		return;

	const animation = starRewardAnimation;
	starRewardAnimation = null;
	animation.resolve(false);
}

function EnsureThoughtObject(runtime)
{
	let thought = GetFirstInstance(runtime, "dusun");
	if (!thought)
	{
		const objectType = runtime.objects.dusun;
		if (!objectType)
			return null;

		thought = objectType.createInstance("Layer 0", -WRONG_THOUGHT_WIDTH, -WRONG_THOUGHT_HEIGHT);
	}

	thought.stopAnimation();
	thought.setSize(WRONG_THOUGHT_WIDTH, WRONG_THOUGHT_HEIGHT);
	thought.opacity = 0;
	thought.isVisible = false;
	thought.isCollisionEnabled = false;
	return thought;
}

function StartWrongThoughtAnimation(runtime, answerCard)
{
	CancelWrongThoughtAnimation();

	const thought = GetFirstInstance(runtime, "dusun") ?? EnsureThoughtObject(runtime);
	if (!thought || !answerCard)
		return Promise.resolve(false);

	const x = answerCard.x;
	const y = Math.max(140,
		answerCard.y - answerCard.height / 2 - WRONG_THOUGHT_HEIGHT / 2 - 25);

	thought.setPosition(x, y);
	thought.setSize(WRONG_THOUGHT_WIDTH, WRONG_THOUGHT_HEIGHT);
	thought.opacity = 1;
	thought.isVisible = true;
	thought.moveToTop();

	return new Promise(resolve =>
	{
		wrongThoughtAnimation = {
			thought,
			startedAt: runtime.wallTime,
			x,
			y,
			resolve
		};
	});
}

function UpdateWrongThoughtAnimation(runtime)
{
	const animation = wrongThoughtAnimation;
	if (!animation)
		return;

	const elapsed = runtime.wallTime - animation.startedAt;
	const thought = animation.thought;
	if (elapsed >= WRONG_THOUGHT_SECONDS)
	{
		thought.opacity = 0;
		thought.isVisible = false;
		wrongThoughtAnimation = null;
		animation.resolve(true);
		return;
	}

	const pulse = (Math.sin(elapsed * 12) + 1) / 2;
	thought.setPosition(animation.x, animation.y - pulse * 6);
	thought.setSize(
		WRONG_THOUGHT_WIDTH * (1 + pulse * 0.035),
		WRONG_THOUGHT_HEIGHT * (1 + pulse * 0.035)
	);
	thought.opacity = Math.floor(elapsed / 0.16) % 2 === 0 ? 1 : 0.2;
}

function CancelWrongThoughtAnimation()
{
	if (!wrongThoughtAnimation)
		return;

	const animation = wrongThoughtAnimation;
	wrongThoughtAnimation = null;
	try
	{
		animation.thought.opacity = 0;
		animation.thought.isVisible = false;
	}
	catch
	{
		// The previous layout may already have destroyed the instance.
	}
	animation.resolve(false);
}

function ResetAnswerLabels(runtime)
{
	const labels = GetSortedInstances(runtime, "abc");
	for (let index = 0; index < labels.length; index++)
		labels[index].animationFrame = ANSWER_LABEL_FRAMES[index];
}

function SetupEndingConfetti(runtime)
{
	const oldEmitters = runtime.objects.Particles?.getAllInstances() ?? [];
	for (const emitter of oldEmitters)
		emitter.isVisible = false;

	const width = runtime.layout.width;
	const height = runtime.layout.height;
	for (let index = 0; index < 180; index++)
	{
		const x = Math.random() * width;
		const y = RandomBetween(-height * 0.25, height * 0.75);
		CreateFallingConfettiPiece(runtime, x, y);
	}
}

function CreateFallingConfettiPiece(runtime, x, y)
{
	CreateConfettiPiece(runtime, x, y, {
		vx: RandomBetween(-85, 85),
		vy: RandomBetween(150, 340),
		gravity: RandomBetween(35, 80),
		life: RandomBetween(5.5, 8),
		size: RandomBetween(20, 42),
		spin: RandomBetween(-7, 7)
	});
}

function BurstConfetti(runtime, x, y)
{
	for (let index = 0; index < 42; index++)
	{
		const angle = RandomBetween(0, Math.PI * 2);
		const speed = RandomBetween(260, 650);
		CreateConfettiPiece(runtime, x, y, {
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 120,
			gravity: 720,
			life: RandomBetween(1.25, 2.1),
			size: RandomBetween(18, 36),
			spin: RandomBetween(-12, 12)
		});
	}
}

function CreateConfettiPiece(runtime, x, y, options)
{
	const objectType = runtime.objects.konfeti;
	if (!objectType)
		return;

	const instance = objectType.createInstance("Layer 0", x, y);
	instance.stopAnimation();
	instance.animationFrame = Math.floor(Math.random() * CONFETTI_FRAME_COUNT);
	instance.setSize(options.size, options.size);
	instance.angle = RandomBetween(0, Math.PI * 2);

	confettiPieces.push({
		instance,
		vx: options.vx,
		vy: options.vy,
		gravity: options.gravity,
		spin: options.spin,
		life: options.life,
		maxLife: options.life
	});
}

function UpdateConfetti(runtime)
{
	const dt = Math.min(runtime.dt, 0.05);
	if (runtime.layout.name === "son")
	{
		endingConfettiAccumulator = Math.min(20, endingConfettiAccumulator + dt * 28);
		while (endingConfettiAccumulator >= 1 && confettiPieces.length < 260)
		{
			CreateFallingConfettiPiece(runtime, Math.random() * runtime.layout.width, -50);
			endingConfettiAccumulator--;
		}
	}

	if (confettiPieces.length === 0)
		return;

	for (let index = confettiPieces.length - 1; index >= 0; index--)
	{
		const piece = confettiPieces[index];
		const instance = piece.instance;
		piece.life -= dt;

		if (!instance || piece.life <= 0)
		{
			instance?.destroy();
			confettiPieces.splice(index, 1);
			continue;
		}

		piece.vy += piece.gravity * dt;
		instance.setPosition(instance.x + piece.vx * dt, instance.y + piece.vy * dt);
		instance.angle += piece.spin * dt;
		instance.opacity = Math.min(1, piece.life / Math.min(0.45, piece.maxLife));
	}
}

function RandomBetween(minimum, maximum)
{
	return minimum + Math.random() * (maximum - minimum);
}

function ScheduleLayout(runtime, layoutName, delaySeconds)
{
	pendingLayout = layoutName;
	pendingLayoutAt = runtime.wallTime + delaySeconds;
}

function GetActiveMapButton(runtime)
{
	if (progress < 0 || progress >= STAGES.length)
		return null;

	return runtime.getInstanceByUid(STAGES[progress].buttonUid);
}

function GetFirstInstance(runtime, objectName)
{
	return runtime.objects[objectName]?.getFirstInstance() ?? null;
}

function GetSortedInstances(runtime, objectName)
{
	const objectType = runtime.objects[objectName];
	if (!objectType)
		return [];

	return objectType.getAllInstances()
		.filter(instance => !hoverCloneInstances.has(instance))
		.sort((a, b) => a.x - b.x);
}

function Hit(instance, x, y)
{
	return Boolean(instance?.isVisible && instance.containsPoint(x, y));
}

function SetFrame(instance, frame)
{
	if (!instance)
		return;

	instance.stopAnimation();
	instance.animationFrame = frame;
}

async function PlayAudio(runtime, fileName, kind)
{
	StopAudio();
	const requestId = audioRequestId;

	const audioObject = runtime.objects.Audio;
	if (!audioObject)
		return false;

	currentAudioKind = kind;

	try
	{
		await ResumeAudio(runtime);

		const audioBuffer = await LoadAudioBuffer(runtime, fileName);

		if (audioRequestId !== requestId || currentAudioKind !== kind)
			return false;

		const source = audioObject.audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(audioObject.destinationNode);
		SetMusicDucked(kind === "instruction" || kind === "problem");

		return await new Promise(resolve =>
		{
			let settled = false;
			const finish = completed =>
			{
				if (settled)
					return;

				settled = true;
				if (currentAudioSource === source)
				{
					currentAudioSource = null;
					currentAudioKind = "";
					currentAudioResolve = null;
					SetMusicDucked(false);
				}

				resolve(completed);
			};

			currentAudioSource = source;
			currentAudioResolve = finish;
			source.addEventListener("ended", () => finish(true));
			source.start();
		});
	}
	catch (error)
	{
		currentAudioKind = "";
		SetMusicDucked(false);
		console.warn("Ses oynatilamadi.", error);
		return false;
	}
}

async function StartBackgroundMusic(runtime)
{
	if (musicSource)
	{
		await ResumeAudio(runtime);
		return;
	}

	if (musicStartPromise)
	{
		const pendingStart = musicStartPromise;
		await pendingStart;
		if (!musicSource)
			return StartBackgroundMusic(runtime);
		return;
	}

	const requestId = musicRequestId;

	musicStartPromise = (async () =>
	{
		const audioObject = runtime.objects.Audio;
		if (!audioObject)
			return;

		try
		{
			await ResumeAudio(runtime);
			const audioBuffer = await LoadAudioBuffer(runtime, "FonSarki1.webm");
			if (musicSource || musicRequestId !== requestId)
				return;

			musicGainNode = audioObject.audioContext.createGain();
			musicGainNode.gain.value = isMusicMuted ? 0 : (isMusicDucked ? MUSIC_DUCKED_VOLUME : MUSIC_VOLUME);
			musicGainNode.connect(audioObject.destinationNode);

			const source = audioObject.audioContext.createBufferSource();
			source.buffer = audioBuffer;
			source.loop = true;
			source.loopStart = MUSIC_LOOP_START_SECONDS;
			source.loopEnd = Math.min(MUSIC_LOOP_END_SECONDS, audioBuffer.duration);
			source.connect(musicGainNode);
			source.addEventListener("ended", () =>
			{
				if (musicSource === source)
					musicSource = null;
			});
			musicSource = source;
			source.start(0, MUSIC_LOOP_START_SECONDS);
		}
		catch (error)
		{
			console.warn("Fon muzigi oynatilamadi.", error);
		}
		finally
		{
			musicStartPromise = null;
		}
	})();

	return musicStartPromise;
}

function StopBackgroundMusic()
{
	musicRequestId++;
	const source = musicSource;
	const gainNode = musicGainNode;
	musicSource = null;
	musicGainNode = null;

	if (source)
	{
		try
		{
			source.stop();
		}
		catch
		{
			// The source may already have ended.
		}
	}

	try
	{
		gainNode?.disconnect();
	}
	catch
	{
		// The gain node may already be disconnected.
	}
}

async function LoadAudioBuffer(runtime, fileName)
{
	let audioBuffer = audioBufferCache.get(fileName);
	if (audioBuffer)
		return audioBuffer;

	const url = await runtime.assets.getMediaFileUrl(fileName);
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`Ses dosyasi yuklenemedi: ${fileName}`);

	const arrayBuffer = await response.arrayBuffer();
	audioBuffer = await runtime.objects.Audio.audioContext.decodeAudioData(arrayBuffer);
	audioBufferCache.set(fileName, audioBuffer);
	return audioBuffer;
}

function SetMusicDucked(isDucked)
{
	isMusicDucked = isDucked;
	ApplyMusicVolume();
}

function ApplyMusicVolume()
{
	if (!musicGainNode)
		return;

	const target = isMusicMuted ? 0 : (isMusicDucked ? MUSIC_DUCKED_VOLUME : MUSIC_VOLUME);
	const now = musicGainNode.context.currentTime;
	musicGainNode.gain.cancelScheduledValues(now);
	musicGainNode.gain.setTargetAtTime(target, now, 0.08);
}

async function ResumeAudio(runtime)
{
	const audioContext = runtime.objects.Audio?.audioContext;
	if (audioContext?.state === "suspended")
	{
		try
		{
			await audioContext.resume();
		}
		catch (error)
		{
			console.warn("Ses sistemi baslatilamadi.", error);
		}
	}
}

function StopAudio()
{
	audioRequestId++;
	const source = currentAudioSource;
	const resolveAudio = currentAudioResolve;
	currentAudioSource = null;
	currentAudioKind = "";
	currentAudioResolve = null;
	SetMusicDucked(false);

	if (resolveAudio)
		resolveAudio(false);

	if (source)
	{
		try
		{
			source.stop();
		}
		catch
		{
			// The source may already have ended.
		}
	}

}
