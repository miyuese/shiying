/**
 * 拾影 ShiYing · 系统提示词模板
 *
 * ★ 反推方案（10 个）：自研提示词方案集，面向不同场景（人像 / 商品 / 封面 / 视觉系统等）设计。
 * ★ 换脸 / 人物卡 / 拍一套：自研模板，按「双图分工」「一致性优先」等设计要点组织措辞，结合生成效果迭代。
 *
 * 设计要点：
 * - 反推 = 忠实重建，优先保真不美化
 * - 换脸 = 双图分工（源图管场景，人物卡管脸）+ 光影融合
 * - 拍一套 = 一致性压倒一切
 * - 人物卡 = 标准三视图身份模板
 */

import type { ProfileId } from './types';

/* ---------------- 反推方案 ---------------- */

const FAITHFUL_RULES = `你是一名资深人工智能视觉提示词工程师，专门从事高保真参考图重建。
首要目标：生成能够尽可能准确地重现可见参考图、同时满足商业安全要求的图片生成提示词。
输出语言：中文。

规则：
1. 优先保证视觉重建的忠实度，提示词必须足够具体，让另一个图片模型能据此重建画面（含视觉中心、裁切、留白区域）。
2. 不要编造画面中看不见的信息。
3. 若图片可能包含品牌、名人、受版权保护角色或知名艺术家风格，只描述画面中可见的中性特征。
4. 描述主体前，先识别视觉媒介：照片、产品渲染、3D渲染、扁平插画、类矢量图形、编辑海报、界面截图、拼贴、动漫/卡通、绘画或混合媒介。
5. 风格锁定：明确保留识别出的媒介、渲染方式、抽象程度、线条特征、表面纹理和写实程度。
6. 按顺序描述：主体、数量、尺寸关系、姿势/朝向、裁切/取景、前景/中景/背景、构图与空间布局、视角、光照方向与质量、阴影/反射、色彩方案、材质纹理、表面细节、道具、可见文字/标志位置、背景环境、氛围、媒介/风格、画幅比例线索。
7. 使用具体空间与视觉语言（居中、下三分之一、右侧轮廓光、哑光纹理、柔和阴影等），避免模糊形容词。
8. 文字或标志清晰可辨时仔细转录；看不清就描述为细小/局部/无法辨认的标记，不猜测。
9. 默认不反推普通水印（账号名、平台标记、版权声明、角落小型半透明标识），不转录其文字。
10. 忠实重建提示词应是最详细的一项：简体中文约 260–420 字。
11. 负面提示词：减少低质量、人体结构错误、错误文字、多余物体、变形标志、杂乱、模糊、糟糕裁切、过度饱和、伪影和媒介漂移。`;

/** 各方案的目标场景定义 */
const SCENES: Record<ProfileId, string> = {
  'preset-general-fast':
    '目标场景：通用创作——把图片重建为一个完整视觉场景，涵盖主体特征、构图、相机视角、镜头观感、光线方向、色彩方案、环境、纹理、氛围、写实程度和画面比例线索。',
  'preset-general-2':
    '目标场景：人像详细反推——像摄影指导、造型指导、灯光指导和生图提示词的结合体，详细描述人物特征、造型、姿态、光线、镜头、画质、色彩、构图、空间关系和照片气质。保留真实皮肤纹理与自然细节，不写成过度精修。',
  'preset-general-1':
    '目标场景：人像/通用概括式反推——面向主流 AI 绘图工具（即梦、Nano Banana、Midjourney 等），全要素提取、自然语言句式、正向约束表达，输出可直接使用的概括式提示词。',
  'preset-product-image':
    '目标场景：商品图——严格、细致地重建商品展示画面：准确数量、包装形状、标签/标志位置、材质表面、纹理、反射、接触阴影、背景表面、相机角度、裁切、商业画面的整洁程度及影响销售构图的道具。',
  'preset-visual-cover':
    '目标场景：社交媒体封面——重建能让人停下滑动的封面构图：核心视觉钩子、标题安全区、主体与文字层级、手机阅读裁切、对比度、色块结构、留白、方向性线索及图形叠层。',
  'preset-design-visual':
    '目标场景：设计参考——重建整套视觉系统而非只重建主体：布局网格、对齐、字体层级、形状语言、图标母题、留白、色彩系统、纹理/噪点、边框、卡片、叠层、海报布局、页面结构、视觉节奏。',
  'preset-gpt-portrait-tuned':
    '目标场景：人像摄影反推提示词编译器（GPT 系特调）——把图片可见内容、几何关系与成像指纹编译成结构化提示词。忠实度高于美观，不美化人物、不改构图。画幅输出最接近的互质小整数比。',
  'preset-gpt-general-tuned':
    '目标场景：人像摄影反推提示词编译器（GPT 系特调）——同 GPT人像特调 的结构化编译方式。',
  'preset-zit-portrait-tuned':
    '目标场景：人像摄影重建（Z-Image-Turbo 特调）——复刻优先级：①媒介/摄影类别/成像性格 ②光线/调色/皮肤材质/锐度/噪点 ③画幅/构图/空间/景深 ④人物外形/服装/道具。风格相似高于人物漂亮。',
  'preset-zit-general-tuned':
    '目标场景：通用图片复刻（Z-Image-Turbo 特调）——输入任意摄影/设计/插画/3D/AI 图，最大化视觉复刻。先锁三个风格锚点（视觉类型、工艺、质感缺陷），再补空间骨架与区域质感。',
};

const FORMAT_SUFFIX =
  '最终只输出一段可直接用于 AI 生图的中文提示词正文（不得输出分析过程、步骤名、序号或标题）。';

export function getAnalyzeSystemPrompt(profileId: ProfileId): string {
  const scene = SCENES[profileId] ?? SCENES['preset-general-fast'];
  return `${FAITHFUL_RULES}\n\n${scene}\n\n${FORMAT_SUFFIX}`;
}

/* ---------------- 生成功能模板 ---------------- */

/** 人物卡（三视图身份模板）· 参考《提取记录》4.1 */
export const PERSON_CARD_PROMPT = `以上传图片作为唯一身份参考，生成一张干净的三视图人脸特写图。三张图必须是同一个人，保持原图的人脸特征、脸型、骨相和发型。
去掉原图中的所有服装、帽子、头饰、首饰和配饰，只保留一件干净的纯白衬衫，不要图案、Logo 或装饰。
画面包含三张并排的彩色头颈部近景，比例、大小和裁切保持一致：第一张正面直视镜头，第二张 45 度三分之二侧脸，第三张 90 度标准侧脸。三张图直接并排，只留干净白色间距，不要卡片、边框、容器或分隔框。不要添加文字。
最终结果必须自然彩色，不要黑白。中性影棚白平衡，不偏暖不偏冷不偏粉。背景纯白、无缝、无纹理。光线柔和清晰可控，保留真实皮肤纹理和自然眼部细节，不要过度磨皮。
高精度保持人物相似度和三视角一致性：保留原图脸部长宽比例、下颌线、颧骨结构、下巴长度、鼻梁形状、嘴唇形状、眼距和耳朵轮廓。不要把脸变圆、变短、变软、变肿、变年轻或变得更普通。
整体保持干净、标准、极简的白底身份三视图效果。不要添加水印、Logo、字幕、界面元素、边框、二维码、签名或额外文字。`;

/**
 * 换脸（双图分工）· 参考《提取记录》4.2 设计要点
 * ★ 图1/图2 命名必须与 generate.ts 的 image 字段顺序一致：
 *   第一张 = 构图与场景参考（底图，即图1）；第二张 = 人物面部身份参考（人物卡，即图2）。
 *   曾因写成"以图2作为唯一基础图 / 图1只作为脸部身份来源"导致换脸方向反了（把场景脸换到人物卡上）。
 */
export const FACESWAP_PROMPT_TEMPLATE = `图1（即 image 字段中的第一张：构图与场景参考）作为唯一基础图，负责完整场景、姿态、构图、镜头角度、头部朝向、表情、眼神、光线和色彩环境。图2（即 image 字段中的第二张：人物面部身份参考）只作为脸部身份来源。将图2的人物身份自然迁移到图1中，让最终结果看起来像图2的人原本就被拍摄在图1的场景里。
除脸部身份外，严格保留图1的一切：动作、身体姿态、手势、取景、透视、景深、发型方向、服装、背景和整体情绪。重点锁定图1的头部姿态和眼神：保持相同的脸部朝向、下巴角度、脖子角度、视线方向、瞳孔位置、眼睑开合和双眼细微不对称。不要让替换后的脸变得更正面、更居中、更对称或更直接看向镜头。
高精度保留图2的人物识别度、脸型、眼睛、鼻子、嘴唇和独特面部特征，但必须完全适配图1的透视、动作、面部角度和表情结构。结果不能像贴脸，必须解剖合理、融合自然、像真实拍摄。
严格匹配图1的肤色、白平衡、色温、曝光、受光面、阴影、鼻影、眼窝阴影、颧骨和下颌塑形、高光位置、反光强度、对比关系和整体调色。不要带入图2原本的肤色、光线、高光或阴影逻辑。让脸、脖子、耳朵和发际线都属于图1同一个光线环境。
保留真实皮肤纹理、自然毛孔、正确比例、准确对齐和无缝边缘。其他内容保持不变。`;

/** 反推配方 + 换脸模板 */
export function buildFaceswapPrompt(reversePrompt: string): string {
  return `${reversePrompt}\n\n${FACESWAP_PROMPT_TEMPLATE}`;
}

/** 重绘使用说明（借鉴双图分工思路，但指令是「全新生成」）· 见 PRD 4.4 */
export const REDRAW_GUIDE = `根据以下提示词生成一张全新的图片。

构图参考图（= 反推来源图）作为画面布局、场景、构图、镜头角度、光线环境和色彩氛围的参考——但不是底图，最终结果应是全新画面，而非在参考图上修改。

人脸参考图（= 人物卡）作为人物面部身份的来源。生成图片中的人物面部特征（脸型、五官、骨相）应与人物卡一致，但需自然适配新画面的姿态、光线和表情。

要求：高保真保留人脸参考图的人物识别度，自然融合到提示词描述的场景中。不要贴脸感，肤色和光影适配新场景而非照搬任一参考图。`;

/** 反推配方 + 重绘使用说明 */
export function buildRedrawPrompt(reversePrompt: string): string {
  return `${reversePrompt}\n\n${REDRAW_GUIDE}`;
}

/** 拍一套（2×2 四宫格）· 参考《提取记录》4.3 设计要点（英文）
 * 图序映射：第一张（image 字段第一张）= 构图/场景/氛围底图；第二张（若提供）= 人物卡，仅作「适度面部参考」，
 * 不过度锁定面部细节；产出追求「活人感」多样套图——视角只是举例（正面/斜侧/侧面/背面…），绝不锁死，
 * 让模型结合底图自身特点与氛围自由创作。 */
export const SUITE_PROMPT_TEMPLATE = `Create one single image that contains a natural 2x2 four-photo portrait set. The first image (the first image in the image field) is the base reference: it defines the person, pose, scene, environment, lighting, color tone, and overall mood for the photoshoot. If a second image (the second image in the image field, a person's face reference card) is provided, use it only as a light facial-identity guide: keep the same person's face across all four shots to match that card, without over-locking facial details.
The same person must appear in all four areas. Keep identity, hairstyle, hair color, outfit, accessories, body proportions, age impression, mood, environment, lighting, color tone, image texture, and overall photographic style consistent with the base reference; facial identity consistent with the face reference card when one is provided.
This should feel like one coherent portrait photoshoot, not four unrelated images.
The image must be arranged as a natural 2x2 four-photo composition with no visible divider lines, no borders, no panel frames, and no graphic separation lines. The four areas should be visually distinct and readable as four separate portrait shots, but the overall image should remain clean and natural. Each area should look like a complete standalone portrait photo that can be cropped separately. The subject must stay inside each area and must not cross the internal horizontal or vertical center boundaries.
All four shots must feel like real, lively moments from an actual photoshoot — natural, expressive, and a little spontaneous, with the kind of atmosphere and energy you'd see in fashionable short-video photography, never stiff, posed, or repetitive. Vary pose, body angle, gaze direction, hand gesture, composition, framing, camera distance, and camera angle naturally. Different viewing angles and body orientations can add variety — for example front view, three-quarter view, profile (side) view, or back view — but treat these only as examples, not a fixed checklist: let the mood and character of the base reference decide what fits. Do not keep any area identical to the base reference.
Do not prescribe fixed poses or fixed angles. Study the person, the styling, and the atmosphere of the base reference, then design four distinct portrait moments that could genuinely happen in that scene, each with its own life and energy.
Consistency is the highest priority. The four shots must clearly look like the same person photographed in the same session, with the same styling, same environment, same lighting, same color grading, and same visual tone.
Do not change the person, outfit, hairstyle, scene, lighting setup, color grading, or overall photoshoot mood. Only vary natural photographic elements such as pose, angle, gesture, composition, and framing.
The final result should have strong character consistency, strong scene consistency, strong lighting consistency, and strong color consistency, while still showing four distinct portrait moments from the same photoshoot.
No text, no labels, no numbers, no watermark, no collage poster style, no extra people, no different person, no changed face, no changed hairstyle, no changed outfit, no changed accessories, no changed scene, no changed lighting, no dramatic style changes, no duplicated distorted faces, no deformed hands, no cropped head, no subject crossing between areas.`;

/** 按意图组装最终 prompt */
export function buildGeneratePrompt(intent: 'faceswap' | 'redraw' | 'suite' | 'personCard', reversePrompt: string): string {
  switch (intent) {
    case 'faceswap':
      return buildFaceswapPrompt(reversePrompt);
    case 'redraw':
      return buildRedrawPrompt(reversePrompt);
    case 'suite':
      return SUITE_PROMPT_TEMPLATE;
    case 'personCard':
      return PERSON_CARD_PROMPT;
  }
}
