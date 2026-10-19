# 开放世界委托链路

## 目标

统一开放世界事件邀约、真实委托、地图页提示与任务页展示的口径，避免出现“接了以后从待回应消失，但又不在任务里出现”的吞单状态。

## 当前链路

1. 玩家先在 `playerWorldEventOffers` 中收到 `pending` 的世界事件邀约。
2. 玩家点击接受后，服务端在 `respondPlayerWorldEventOffer(...)` 内决定：
   - 是即时结算型邀约
   - 还是要转成可追踪的 world contract
3. 只有生成了有效 `contractType + contractStatus` 的 accepted offer，才会被：
   - `/api/game/world/contracts`
   - `/api/game/quest/list`
   - 地图页世界摘要
   一起识别并展示为可追踪委托。

普通 `pending` 世界邀约虽然还没转成 contract，也必须参与开放世界首页的轻摘要与“可响应事件”预算，避免出现后台已经有来信，但首屏像没事件的错位。

任务页读取世界委托时，也不允许再把读取异常静默吞成“空列表”；若世界委托链单独失败，前台必须明确提示“世界委托暂时读取失败”，避免玩家误判为自己没有后续。

## 任务型邀约规则

以下 `offerType` 必须生成可见 contract；若 contract 生成失败，接口会直接报错回滚，不再静默写成 `accepted`：

- `shadow_intel`
- `cultivator_hunt`
- `black_market_trade`
- `treasure_invite`
- `broker_relief`
- `demonic_temptation`

## 传话委托修复

`broker_relief` 现在固定走 `meet_contact` 合同流：

- 接受后会生成真实可见的“递话说项”委托
- 地图页与任务页都能看到目标 NPC、目标地图和推进说明
- 到目标 NPC 身边后，可继续推进并结清这桩委托

这样“牙子递话/传话委托”不再出现：

- 从待回应列表消失
- 又不进入任务页
- 玩家完全找不到后续目标

## 口径约束

- `pending`：待回应邀约
- `accepted + contractType/contractStatus 有效`：可见委托
- `accepted + contract 字段缺失`：视为异常，禁止落库
- `completed`：委托完成态通过 `payloadJson.contractStatus` 标记，不再靠额外任务表兜底

## 本次修复点

- 为 `broker_relief` 补上 `meet_contact` 型 contract payload
- 统一收口任务型 offer 的生成守卫，避免 future offer 再次吞单
- 补正 `broker_relief` 在接单与完成时的叙事文案，使其不再误显示为“情报接头”
- 把普通世界邀约重新接回地图轻摘要，让首屏“可响应事件”不再只吃成人邀约和已接委托
- 任务页改成显式暴露世界委托读取异常，不再用空数组伪装成“没有委托”
