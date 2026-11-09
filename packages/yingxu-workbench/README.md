# 映序 · 独立素材工作台

沿用用户指定内网站点的前端界面与 12 个模块，以新编写的 Python / SQLite 后端补齐本机工作流。作为 AI 决策仓库中的独立子项目，不改变主应用的构建或部署。

## 启动

需要 Python 3.10+；视频元数据、封面和关键帧处理需要 `ffmpeg` 与 `ffprobe` 在 PATH 中。无 Python 第三方依赖，不需要 npm install。

在本目录执行：

```sh
python3 server.py
```

浏览器访问 http://127.0.0.1:8767 。可通过 `PORT` 改端口。默认只监听本机，不提供公网托管或多人登录。

可选：首次使用时执行 `python3 seed_demo.py`，写入三条明确标注的虚构演示素材与投放事实；演示空间已有内容时不会覆盖，Android/iOS 真实产品不受影响。

## 已实现

- 素材库：列表、卡片、搜索、脚本/制作人/分类筛选、CSV 导出、视频详情。
- 上传：MP4/MOV、批量/文件夹、每条 500 MB、每批 200 条、流式落盘、SHA-256 产品内去重、批次封存。
- 视频：FFmpeg 元数据、首帧封面、覆盖开头至结尾的 5–40 个采样关键帧、HTTP Range 播放；封存后后台处理，重启恢复排队。
- 复核：受控标签、主脚本/来源确认、较早批次来源约束、版本冲突检测、人工锁定、审计与最新复核撤销。
- 脚本：创建、按脚本浏览；从未归组素材创建独立候选、编辑、移动、拆组、逐条核对后确认入库。默认不凭文件名合并剧情。
- 日报与周报：北京时间入库日期、分类、脚本与内容方向下钻、测试覆盖、花费和成熟 D0/D7 回收。
- 投放：素材/脚本/标签/来源视图、Campaign 展开、JSON 导入、人工事实映射、重复导入保留映射；组合广告不重复分摊。
- 同期群：完整状态与成熟日期检查、唯一归属、去重、真实零收入与缺失区分。
- 设置：质量规则草稿持久化、词表与集成可用状态。和原页面一样，规则仍为草稿，不自动宣布“值得裂变”。

## 本机存储与备份

`data/workspace.sqlite3` 保存三个隔离产品空间的数据；`data/media`、`data/covers`、`data/frames` 保存媒体。`YINGXU_DATA` 可指定绝对路径。数据库使用 WAL 与事务提交，服务进程内串行化写操作。请只启动一个服务进程访问同一目录。备份时先停止服务，再复制整个 data 目录。

数据目录、视频、数据库、日志与 `.env` 不提交 Git。运行时不会访问原内网站点，不包含原站素材或数据库，也不读取其他项目的凭据。

## 内容分析适配器（可选）

设置 `YINGXU_ANALYSIS_URL` 和可选 `YINGXU_ANALYSIS_TOKEN` 后重启服务。服务 POST JSON，包含 `asset_id`、`name`、`duration`、`taxonomy`、`frames: [{at, jpeg_base64}]`。授权放在 Bearer 请求头；发送采样画面与单声道 16 kHz WAV 音轨，不发送整个视频。

适配器必须返回 JSON：

```json
{
  "summary":"有证据支持的剧情摘要",
  "script_title":"脚本建议名",
  "tags":["重逢"],
  "creative_analysis":{
    "timeline":[{"stage":"开场","start_frame":0,"end_frame":1,"visible_text":"可见字幕","visible_script":"可见画面"}],
    "presentation":"画面表现形式",
    "character_styling":"角色造型",
    "conclusion":"总结与局限"
  }
}
```

只接纳词表中标签；分析结果作为建议保存，不覆盖人工确认的字段。服务未配置时，只处理元数据和关键帧，明确显示“内容分析尚未配置”，不会生成虚构 AI 结果。接入任意模型时需自行实现该 HTTP 契约；本项目不内置特定模型供应商客户端。

## Doris / 投放数据（可选）

无需 Doris 也可在“数据关联”或“设置”点击“导入投放 JSON”。格式见 [example-facts.json](public/example-facts.json)，其中数据是虚构样例。`facts` 必需字段：`date`、`channel`、`country`、`creative_id`、`spend`。可附带 `cohorts`。空缺指标用 null；完整标记用 JSON boolean。

事实身份由日期、渠道、国家、素材 ID/名称、Campaign 和 Adgroup 构成。重复导入更新指标，保留已有人工映射；不同产品分开保存；文件内相同身份最后一行生效。导入为增量更新，不隐式删除历史记录。

若设置 `YINGXU_DORIS_URL` 与可选 `YINGXU_DORIS_TOKEN`，同步按钮可调用只读适配器：输入 `{product,start,end}`，输出同上述导入格式 `{facts,cohorts}`。项目不假定真实数据库表名、不自动复用任何账户。实际授权、字段口径和适配器需部署者配置；未与真实 Doris 或模型服务联调。同步不宣称已经对账。

## 验证

```sh
python3 -m unittest test_server -v
python3 -m unittest test_http -v
npm run check
```

单元验证覆盖复核撤销与冲突、来源时间约束、产品隔离、候选确认、重复导入保留映射、成熟回收去重与零值、未配置服务。HTTP 集成测试使用临时目录和合成视频，覆盖真实上传、去重、FFmpeg 采样、封面、Range 播放、跨站写入拒绝、封存与重启持久化。

## 范围

这是依据原前端契约重建的独立实现，不是原后端源码恢复。三方 AI/Doris 需配置适配器；没有原站历史媒体与数据。音轨转写与交叉核对由配置的分析适配器提供；暂不提供断点续传、自动质量判定、多人权限或生产公网部署。原前端采集指纹见 capture-manifest.json（记录采集时文件，后续修改后哈希会不同）。


## V6 修订3：上传识别与自动命名

原规则、200 码字典和校验器随项目保存在 v6/；命名为 24 个固定字段，15 类标签。自动命名保留从原名明确解析出的日期、渠道、人员与语言，不采纳模型猜测的元数据。缺失元数据在详情“核对标签与命名”中填写。旧名中的剧情码不自动迁移；TMM 不作为制作人。

配置的分析适配器现在收到 `v6_dictionary`、`v6_rules`、`v6_metadata`、覆盖视频全段的 `frames`、`has_audio` 和 `audio_wav_base64`。需在原输出中增加 `v6` 对象：

```json
{
  "tags": {"一级分类":["sr"],"其余14类":"按字典提供完整短码数组"},
  "na_reasons": {"职业与身份":"主体剧情未提供职业"},
  "evidence": {"sr":{"source":"dialogue","at":2.0,"observation":"已核验的主体对白依据"}},
  "story_segments":[{"start":0,"end":18}],
  "visual_reviewed":true,
  "subtitle_reviewed":true,
  "audio_review":{"status":"reviewed","note":"核对角色对白与剧情字幕；忽略背景歌声","segments":[{"start":1,"end":3,"text":"角色对白原文"}]}
}
```

上述为字段说明片段，完整 tags 示例在 v6/references/example.json。每个正式短码都必须有证据；非用户说明的证据须带主体剧情范围内时间戳。`na` 逐类填写原因、`unk` 仅草稿。音轨必须完成核验（reviewed 或检查后 no_dialogue）；没有音轨的文件记录 no_audio。未通过检查、超过长度上限或重名时仅保存待核对项，不改成正式名称。

通过后自动更新展示名并提供“下载 V6 命名副本”；原名、物理视频与审计保留。页面大类、标签和筛选显示中文及英文全称（如 AI photorealistic portrait，而非 air），文件名使用原字典短码。V6 大类分析仅统计完成命名的素材；多标签组可能重叠，禁止相加。周报优先使用已完成 V6 的一级分类。

真实多模态模型服务尚需按契约配置；测试适配器只验证数据传递和流水线，不代表模型识别准确率。无服务时上传仍可采样并人工核对，不会冒称已经识别语音。

验证：`python3 -m unittest test_server test_v6 test_http test_auto_naming -v`。
