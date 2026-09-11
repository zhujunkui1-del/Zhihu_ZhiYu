# 知遇（Zhiyu）AI 社交匹配平台
## AI Agent 产品理解与开发规范文档

**文档版本：** v2.1（v2.0 + 六源数据接入扩展）
**项目名称：** 知遇（Zhiyu）  
**项目定位：** 基于 Multi-source Persona 与 AI Agent 的人格匹配与兴趣社交全栈平台  
**核心赛道：** AI × 社区连接 × 兴趣社交 × Agent  
**核心口号：** **让 Agent 先替你认识一个人。**

> v2.1 更新：Persona 数据来源由「微信 / 知乎 / SBTI」扩展为「微信 / QQ / 飞书 / 钉钉 / 知乎 / SBTI」六源，相关章节（3 / 4 / 20 / 22 / 23 / 28 / 31）已同步；接入细则与许可对照以《多平台数据接入方案.md》为准。
> v2.1 增补：第 40 章《Agent 社交边界与数据披露规范》——接入飞书/钉钉等真实数据前必须先落地本章规则。

---

## 0. 给 AI Agent 的最高优先级说明

知遇不是传统的“用户推荐系统”，也不是简单的“AI 聊天机器人”，而是一个由 Persona 驱动、由 Agent 完成第一次认识的人格匹配系统。

核心问题：

> 用户很难判断一个陌生人是否值得认识。

传统社交：

```text
人
↓
浏览陌生人
↓
查看资料
↓
主动聊天
↓
自己承担社交试错成本
```

知遇：

```text
人
↓
建立 Persona
↓
快速匹配
↓
找到可能适合的人
↓
Agent 先替双方交流
↓
生成匹配分析
↓
人决定是否进一步认识
```

核心不是“AI 帮你聊天”，而是：

> **AI 帮你完成认识一个人的第一步。**

---

## 1. 产品愿景

建立一个由 AI Agent 连接人与人的新型社交网络。

最终形成：

```text
Human
↓
Persona
↓
Agent
↓
Agent
↓
Persona
↓
Human
```

即：

> **人 → Agent → Agent → 人**

---

## 2. 产品核心概念

知遇存在三个核心对象：

```text
User
Persona
Agent
```

三者不能混淆。

### 2.1 User

真实用户，拥有：

- 私域数据
- 公共数据
- 主动填写的人格数据
- 自己的 Persona
- 自己的 Agent

### 2.2 Persona

Persona 是用户人格的结构化数字表示。

Persona 是长期存在的数据资产，可以：

- 被搜索
- 被向量化
- 参与匹配
- 长期存储
- 不运行 LLM

示例：

```json
{
  "interests": ["AI", "前端开发", "游戏", "科幻"],
  "thinking_style": ["理性分析", "结果导向", "喜欢探索"],
  "communication_style": ["直接", "简洁", "熟悉后表达活跃"],
  "values": {
    "learning": 0.82,
    "creation": 0.86,
    "social": 0.51
  }
}
```

### 2.3 Agent

Agent 是 Persona 的临时运行实例。

不要把 Agent 理解成“数据库中永久运行的机器人”。

正确理解：

> **当系统需要代表某个 Persona 进行交流时，临时实例化 AI Agent。**

对话结束后：

```text
Agent Session
↓
Match Report
↓
Session 结束
```

核心架构原则：

> **Persona 长期存在，Agent 按需实例化。**

---

## 3. Persona 的数据来源（六源）

```text
              用户
               │
 ┌──────┬──────┼──────┬──────┬──────┐
 ↓      ↓      ↓      ↓      ↓      ↓
微信    QQ    飞书   钉钉    知乎    SBTI
 ↓      ↓      ↓      ↓      ↓      ↓
生活私域 生活私域 职场   职场    公共    显性
 └──────┴──────┴──────┴──────┴──────┘
               ↓
         Persona Fusion
               ↓
            Persona
```

六源对应四类人格语义：

```text
生活私域人格：微信 / QQ（熟人、日常沟通）
职场人格：飞书 / 钉钉（工作沟通、文档、多维表格）
公共人格：知乎（公开表达）
显性人格：SBTI（自我报告）
```

### 3.1 微信：生活私域人格

代表：

> **真实生活中的我 / 私域人格**

可分析：

- 日常表达方式
- 沟通习惯
- 情绪反应方式
- 兴趣
- 问题处理方式
- 熟人沟通特点
- 决策模式

微信数据必须进行 speaker preprocessing。

```json
{
  "conversation": [
    {"role": "other", "content": "你下午能发给我吗？"},
    {"role": "self", "content": "行"}
  ]
}
```

`self` 是人格主要证据，`other` 是理解上下文的辅助信息。

不得把对方说的话直接当成用户人格。

### 3.2 QQ：生活私域人格

代表：

> **真实生活中的我（另一个生活私域）**

可分析：

- 熟人/群聊沟通习惯
- 兴趣社群参与
- 表达方式与话题偏好

QQ 数据的处理原则与微信一致：必须进行 speaker preprocessing，`self` 是主要证据，`other` 仅作上下文。

取数参考：qq-chat-exporter（QCE）导出 JSON/JSONL 后上传；网页端不能直连 QQ，桌面版自动获取属于 Post-MVP（NapCat 路线，GPL-3.0 注意事项见《多平台数据接入方案.md》）。

### 3.3 飞书：职场人格

代表：

> **工作中的我 / 职场人格**

可分析：

- 工作沟通与协作方式
- 文档表达与知识结构
- 职业兴趣与价值观

飞书走**官方开放平台 API + OAuth**，是少数可以进入 Vercel 服务端直连授权的数据源；需要自建应用、用户授权 scope（`im:message`、`im:chat` 等），仅适配中国区 feishu.cn。

### 3.4 钉钉：职场人格

代表：

> **工作中的我（另一职场来源）**

- 文档 / 多维表格：走钉钉官方 API，可服务端接入。
- 消息：钉钉官方 API 不支持历史消息读取，Web 端只能通过用户上传 JSON / 浏览器辅助获取。

### 3.5 知乎：公共人格

代表：

> **公开表达的我 / 公共人格**

可分析：

- 感兴趣领域
- 长期关注话题
- 知识结构
- 观点倾向
- 内容消费方向
- 公开表达方式
- 专业领域
- 社区参与方向

知乎数据必须使用授权、合规可使用的数据来源，并遵守平台 API 与数据使用规则。

### 3.6 SBTI：显性人格

代表：

> **我认为我是怎样的人 / 显性人格**

SBTI 数据是产品内置测试生成、用户主动提供的人格信息。

应区分：

```text
Observed Persona
行为/内容推断

Self-reported Persona
用户主动填写
```

---

## 4. Multi-source Persona Fusion

最终 Persona 不应该只是多份数据的简单拼接，而应该进行：

> **Multi-source Persona Fusion**

```text
微信 / QQ
↓
Communication Evidence（生活 / 熟人语境）

飞书 / 钉钉
↓
Workplace Evidence（工作沟通 / 文档）

知乎
↓
Interest / Knowledge Evidence

SBTI
↓
Self-reported Personality

       ↓
 Fusion Engine
       ↓
 Unified Persona
```

重要人格结论应尽量保留来源和证据：

```json
{
  "trait": "结果导向",
  "value": 0.82,
  "sources": ["wechat", "zhihu"]
}
```

系统应能回答：

> **“为什么你认为我是这样的人？”**

---

## 5. Distilly 的角色

Distilly 作为人物建模 / Persona Distillation 基础设施。

核心流程：

```text
原始材料
↓
Distilly
↓
Person Profile
↓
Persona Feature
↓
Persona Index
```

Distilly 是：

> **人格蒸馏基础设施**

而不是知遇的核心创新本身。

知遇真正的创新集中在：

- Multi-source Persona Fusion
- Match Engine
- Agent-to-Agent Matching
- Match Explanation
- Social Interaction

如果正式使用 Distilly，应遵守其许可证和项目要求。

---

## 6. WeFlow 的角色

如果使用 WeFlow 等工具处理用户本地微信数据，其定位是：

> **微信数据读取 / 导出 / 预处理基础设施。**

推荐：

```text
微信本地数据
↓
WeFlow
↓
聊天记录
↓
Speaker Preprocessing
↓
Distilly
```

原始微信内容尽量本地处理：

```text
Raw Data
↓
Local Processing
↓
Persona
↓
服务器
```

而不是把完整原始聊天记录直接长期上传服务器。

---

## 7. 两级匹配系统

知遇必须将匹配分为：

1. **快速匹配**
2. **Agent 匹配**

这是产品核心交互结构。

---

## 8. 快速匹配

### 8.1 定义

快速匹配：

> **只通过 Persona、Distilly Skill、SBTI 等已经存在的人格数据进行匹配，不启动 Agent-to-Agent 对话。**

目的：

> **快速找到“值得进一步认识的人”。**

流程：

```text
我的 Persona
↓
Embedding
↓
Vector Retrieval
↓
Candidate Pool
↓
结构化人格过滤
↓
Match Scoring
↓
Top Candidates
```

大规模情况下：

```text
海量 Persona
↓
向量召回 Top 1000
↓
人格规则筛选 Top 100
↓
精排 Top 10
```

快速匹配不需要 LLM 对话。

---

## 9. 快速匹配维度

至少包括：

### 9.1 兴趣同频

是否喜欢相似的事情。

### 9.2 思维同频

理解问题的方式是否接近。

### 9.3 价值观匹配

对学习、创造、生活、合作等问题的兼容程度。

### 9.4 沟通适配

双方表达方式是否容易互相理解。

### 9.5 互补度

不能只寻找“和你一样的人”，还要寻找“和你互补的人”。

例如：

```text
A：探索型 + 创意型
B：执行型 + 结果导向
```

兴趣不一定最高相似，但可能：

```text
互补度 = 94%
合作潜力 = 91%
```

---

## 10. 快速匹配结果

不要只显示：

> 匹配度：87%

应该解释：

```text
综合匹配度：87%

兴趣同频      91%
思维方式      84%
价值观        88%
沟通适配      79%
互补程度      94%

为什么推荐？

① 你们都长期关注 AI Agent
② 你的探索型思维与 TA 的执行型思维互补
③ 你们在学习和创造方面具有相似价值倾向
```

核心原则：

> **Match 必须可解释。**

---

## 11. Agent 匹配

当用户选择：

> **“让 Agent 先聊聊”**

系统才启动 Agent。

```text
User A
↓
Persona A
↓
Agent A
      ↘
       Agent-to-Agent Session
      ↗
Agent B
↓
Persona B
↓
User B
```

---

## 12. Agent 匹配不是自由聊天

Agent-to-Agent 对话不是为了让两个 AI 随便聊天。

目的：

> **通过有限的问题，快速判断两个人是否值得进一步认识。**

因此采用：

> **人格探测式对话**

建议：

```text
Round 1：兴趣探索
↓
Round 2：思维方式
↓
Round 3：价值观
↓
Round 4：沟通方式
↓
Round 5：互补关系
```

建议最大：

> **5～8 轮**

或者当信息增益达到阈值时提前停止。

---

## 13. Agent 对话示例

例如：

> 如果你突然拥有一周完全自由的时间，你会怎么安排？

然后根据双方回答动态生成后续问题。

例如：

> 如果你的朋友和你在一个重要问题上意见完全相反，你通常会怎么处理？

再例如：

> 你更愿意把一件事情做到极致，还是同时尝试很多新东西？

系统不是追求聊天时长，而是追求：

> **用最少的对话获得足够的信息完成匹配判断。**

---

## 14. Judge Agent

Agent-to-Agent 对话完成后，由第三个分析模块进行判断。

```text
Agent A
   │
   ├──── Conversation ────┐
   │                      │
Agent B                   ↓
                       Judge
                         ↓
                   Match Report
```

Judge Agent 不代表任何一方。

负责：

- 分析双方回答
- 判断兴趣一致程度
- 判断思维方式
- 判断价值观
- 判断沟通适配
- 判断互补性
- 生成解释

输出示例：

```json
{
  "interest_similarity": 0.91,
  "thinking_compatibility": 0.84,
  "value_compatibility": 0.88,
  "communication_compatibility": 0.79,
  "complementarity": 0.94,
  "overall_score": 0.87
}
```

最终：

> **综合匹配度：87%**

> 你们不是最像的人，但是可能是最适合认识的人。

---

## 15. 海量 Persona 架构

未来可以拥有数千万甚至上亿规模的 Persona 数据池。

但：

> **绝对不能理解为“上亿个 Agent 同时运行”。**

正确模型：

```text
                Persona Index
                     │
              海量 Persona
                     │
              ┌──────┴──────┐
              ↓             ↓
          Vector Search   Metadata
              │             │
              └──────┬──────┘
                     ↓
              Candidate Pool
                     ↓
                Top 10/50
                     ↓
             用户选择候选人
                     ↓
              Agent 按需实例化
                     ↓
              Agent-to-Agent
```

核心原则：

> **海量 Persona 长期存在，Agent 按需实例化。**

---

## 16. Persona Index

每个 Persona 应包含：

```text
persona_id
embedding
interest_vector
personality_vector
communication_vector
value_vector
topic_vector
metadata
source_quality
source_types
updated_at
```

示例：

```json
{
  "persona_id": "persona_102938",
  "embedding": [],
  "interests": ["AI", "游戏"],
  "thinking_style": ["探索型"],
  "communication_style": ["直接"],
  "values": {
    "learning": 0.83,
    "creation": 0.76
  }
}
```

---

## 17. 为什么不能让上亿 Agent 互相寻找

错误架构：

```text
Agent 1
↓
寻找 1 亿 Agent
↓
逐个对话
```

这种 Agent 两两匹配会接近：

> **O(N²)**

规模达到亿级后不可接受。

正确方法：

> **检索，而不是全连接。**

```text
User Persona
↓
Embedding
↓
ANN Vector Search
↓
Top K
```

只从海量 Persona 中快速找到少量高相关候选。

---

## 18. 正确的规模化流程

```text
100,000,000 Persona
        ↓
快速召回
        ↓
1,000
        ↓
精排
        ↓
100
        ↓
推荐
        ↓
10
        ↓
Agent Match
        ↓
1～3
```

只有最后极少数候选需要调用 LLM。

---

## 19. 对外正确表述

不要简单说：

> ❌ 我们拥有上亿个 Agent。

应该说：

> **我们构建大规模 Persona Index，将海量可用的人格信息结构化、向量化；Agent 不常驻，而是在用户触发深度匹配时按需实例化。**

如果未来真的达到亿级，可以称：

> **亿级 Persona Network**

而不是：

> 亿级常驻 Agent 网络。

---

## 20. Persona Pool

未来数据池理论上可以包含：

```text
用户主动创建
↓
真人授权 Persona（注册并完成 OAuth/数据授权后可见可查）

用户邀请好友
↓
好友 Persona

知乎公开创作者（大V 等）公开创作内容
↓
公开创作者 Persona（明示“非本人入驻 / 不代表本人”，支持认领与下架）

AI Synthetic Persona
↓
冷启动 AI 演示人格（虚构，明确标注）
```

必须严格区分：

```text
真人授权 Persona（注册用户）
公开创作者 Persona（真人，但非本人入驻）
AI Synthetic Persona（虚构演示）
```

任何一类都不得冒充另一类：AI 演示人格不得伪装成真人；公开创作者人格必须标注“非本人入驻”，不得暗示其在用知遇。

---

## 21. 冷启动机制

知遇不能依赖“必须有大量真实用户才能使用”。

候选池：

```text
                    Match Engine
                         │
       ┌──────────────┬─┴─────────┬───────────────┐
       ↓              ↓           ↓               ↓
   Real Persona  Invited Persona  Public Creator  AI Persona
    真实用户         邀请用户       公开创作者       AI模拟人格
                              （明示非入驻）
```

当注册真人不足时：

> 提供明确标注的 AI 演示人格，并可预置少量知乎公开创作者 Persona（明示非本人入驻）作为候选补充。

公开创作者 Persona 边界：

- 只使用经官方开放 API / 搜索接口可得的公开创作内容与公开简介；不采集他人的点赞、关注、私信等关系与隐私字段。
- 页面显著标注“公开资料合成 · 非本人入驻 / 不代表本人”，人格结论附原文来源链接。
- 提供认领、申诉与下架入口；数量由人工筛选控制（如 10~30 位），不做全平台抓取。

示例：

- 思考者
- 探索者
- 创作者
- 玩家
- 理性派
- 行动派
- 知识控
- 发明家
- 辩论家
- 世界观察者

不得让 AI Persona 冒充真实用户。

---

## 22. 用户第一次进入产品的完整体验

```text
进入知遇
↓
“让 Agent 先替你认识一个人”
↓
创建我的 Persona
↓
选择数据来源（可多选）
├── 微信 / QQ 聊天记录
├── 飞书 / 钉钉 资料
├── 知乎数据
└── SBTI 测试
↓
Persona 生成
↓
人格完整度
↓
“今天想认识谁？”
↓
快速匹配
↓
候选人列表
↓
查看匹配原因
↓
选择一个候选人
↓
“让 Agent 先聊聊”
↓
Agent-to-Agent
↓
Match Report
↓
“你们可能很适合认识”
```

---

## 23. Persona 完整度

建议加入：

> **人格完整度**

例如：

```text


微信       ✓
QQ         ✓
飞书       ✓
钉钉       ✓
知乎       ✓
SBTI       ✓
```

注意：

> 完整度不是人格真实性的绝对评分，而是系统拥有的人格信息覆盖程度。

完整度建议按“生活私域（微信/QQ）→ 职场（飞书/钉钉）→ 公共（知乎）→ 显性（SBTI）”四类来源统计覆盖，而不是简单按来源数量相加。

---

## 24. Match Engine

Match Engine 是知遇的核心原创模块之一。

输入：

```text
Persona A
Persona B
```

输出：

```text
similarity
compatibility
complementarity
```

至少包含：

```text
Interest Similarity
Thinking Similarity
Value Compatibility
Communication Compatibility
Complementarity
```

最终输出：

> Match Score

不要使用固定的单一权重，应支持不同匹配模式。

---

## 25. Match Mode

建议提供：

```text
❤️ 灵魂同频
⚔️ 最佳辩友
🧩 最佳搭子
🎮 兴趣同好
🧠 思维共振
```

不同模式使用不同权重。

例如：

```text
最佳辩友：
兴趣      15%
思维      35%
价值观    20%
沟通      20%
互补      10%
```

兴趣同好：

```text
兴趣      50%
思维      15%
价值观    10%
沟通      10%
互补      15%
```

---

## 26. 推荐 Persona Schema

```json
{
  "persona_id": "persona_001",

  "identity": {
    "occupation": null,
    "age_range": null
  },

  "interests": [],

  "topics": [],

  "thinking_style": [],

  "communication_style": [],

  "values": {
    "learning": 0,
    "creation": 0,
    "career": 0,
    "social": 0
  },

  "social_style": {
    "initiative": 0,
    "introversion": 0
  },

  "personality": {},

  "embedding": [],

  "sources": [],

  "evidence": [],

  "confidence": {},

  "updated_at": null
}
```

---

## 27. Agent Runtime Schema

Agent 不需要永久保存完整实例。

请求时生成：

```json
{
  "session_id": "session_001",
  "persona_a": "persona_001",
  "persona_b": "persona_938",
  "mode": "soulmate",
  "max_rounds": 6,
  "system_prompt": "...",
  "conversation": []
}
```

对话完成：

```json
{
  "session_id": "session_001",
  "result": {
    "interest": 0.91,
    "thinking": 0.84,
    "values": 0.88,
    "communication": 0.79,
    "complementarity": 0.94
  }
}
```

---

## 28. 系统总体技术架构

知遇采用 **Next.js 全栈架构**，前后端统一部署到 **Vercel**。

核心技术约束：

```text
Frontend
Next.js + React + TypeScript
        │
        ↓
Next.js Route Handlers
        │
        ├── Zhihu OAuth / Open API
        ├── Persona API
        ├── Matching API
        ├── Agent Match API
        └── Notification API
        │
        ↓
PostgreSQL
        │
        ├── User
        ├── Persona
        ├── PersonaFeature
        ├── Match
        ├── AgentSession
        ├── MatchReport
        └── Notification

Agent 后台任务
        ↓
Vercel Workflows
        │
        ├── 创建 Agent Match
        ├── Agent A ↔ Agent B
        ├── Judge
        └── 保存 Match Report
```

完整链路：

```text
用户浏览器
    ↓
Next.js 页面
    ↓
Route Handler
    ↓
PostgreSQL
    ↓
Vercel Workflow
    ↓
Agent A ↔ Agent B
    ↓
Judge
    ↓
Match Report
    ↓
PostgreSQL
    ↓
前端轮询 / SSE / 状态刷新
```

### 28.1 Frontend

使用：

```text
Next.js
React
TypeScript
```

前端负责：

- 页面渲染
- Persona Card
- Match Card
- Persona 雷达图
- Agent 对话展示
- Match Report
- 搜索与筛选
- 通知中心
- 用户交互状态

推荐采用 Next.js App Router。

页面与 API 均位于同一个 Next.js 项目中，不再拆分成独立 frontend / backend 两个部署项目。

### 28.2 API：Next.js Route Handlers

所有业务 API 使用：

> **Next.js Route Handlers**

目录：

```text
app/
└── api/
    ├── auth/
    ├── zhihu/
    ├── candidates/
    ├── persona/
    ├── matches/
    └── notifications/
```

示例：

```text
GET  /api/candidates
POST /api/matches
GET  /api/matches/:id
POST /api/matches/:id/start
GET  /api/notifications
```

Route Handlers 负责：

- 参数校验
- 身份认证
- 权限检查
- 数据库读写
- 调用知乎 API
- 创建 Workflow
- 返回任务状态

不要在浏览器端直接暴露：

- AI API Key
- PostgreSQL 连接信息
- 知乎 OAuth Secret
- 其他服务端凭证

### 28.3 PostgreSQL

PostgreSQL 是知遇的核心持久化数据库。

至少保存：

```text
users
personas
persona_features
persona_sources
matches
agent_sessions
agent_messages
match_reports
notifications
```

推荐：

```text
PostgreSQL
+
Prisma / Drizzle
```

数据库负责：

- 用户数据
- Persona
- Persona 来源与版本
- 匹配结果
- Agent Session 状态
- Match Report
- 通知
- Persona 更新时间

如果需要向量检索，可在 PostgreSQL 上使用：

> **pgvector**

从而让 Persona embedding 与结构化数据保持在同一数据层。

MVP 阶段不要求实现亿级向量规模，但数据模型必须预留：

```text
persona.embedding
```

以及后续 ANN 检索能力。

### 28.4 Vercel Workflows

Agent-to-Agent 匹配属于异步、可能持续较长时间的后台任务。

因此：

> **Agent Match 不应该由普通 Route Handler 同步阻塞完成。**

正确流程：

```text
POST /api/matches
        ↓
创建 Match
        ↓
启动 Vercel Workflow
        ↓
Workflow 执行
        ↓
Agent A ↔ Agent B
        ↓
Judge
        ↓
生成 Match Report
        ↓
更新 PostgreSQL
        ↓
Match 状态 = completed
```

Workflow 可以拆成：

```text
createMatchWorkflow
        ↓
loadPersona
        ↓
buildAgentContext
        ↓
runAgentDialogue
        ↓
runJudge
        ↓
saveMatchReport
        ↓
createNotification
```

用户离开页面后，Workflow 仍应继续执行。

因此前端不能依赖：

```text
页面一直打开
```

来维持 Agent Match。

### 28.5 Agent Session 状态机

Agent Match 应具有明确状态：

```text
pending
↓
running
↓
analyzing
↓
completed
```

异常情况：

```text
running
↓
failed
```

必要时支持：

```text
failed
↓
retrying
↓
running
```

数据库中的 `agent_sessions` 至少记录：

```text
session_id
match_id
status
mode
max_rounds
current_round
started_at
completed_at
error
```

### 28.6 本地数据工具（WeFlow / QCE / 浏览器采集）的部署边界

凡依赖“本机进程 / 本机数据库 / 本机浏览器登录态”的取数工具（微信 WeFlow 系、QQ QCE/NapCat 系、钉钉消息浏览器采集等）**一律不部署到 Vercel**。

正确边界：

```text
用户本地电脑
    ↓
本地工具（WeFlow / QCE / 浏览器采集）
    ↓
聊天记录 / 导出 JSON
    ↓
Speaker Preprocessing
    ↓
Persona Distillation
    ↓
Persona
    ↓
上传必要 Persona 数据
    ↓
Vercel
```

即：

> **WeFlow / QCE 等是本地数据处理工具，而不是线上后端服务。**

Web 端若接收用户上传的导出 JSON，原始文件仅短期保留用于清洗/蒸馏，用后即删；原始聊天记录原则上不作为知遇线上数据库的长期存储对象。详见《多平台数据接入方案.md》。

### 28.7 Distilly 的部署边界

Distilly 是 Persona Distillation 基础设施。

它可以作为：

```text
开发 / 本地 Persona Pipeline
```

或者被封装成适合项目部署的处理步骤。

不要为了“技术完整”而强行把整个 Distilly 工程直接塞进 Vercel Runtime。

知遇真正需要的是：

```text
Input
↓
Persona Distillation
↓
Structured Persona
```

### 28.8 外部授权数据接入（Zhihu / Feishu）

能通过官方 OAuth 直连授权的数据源（知乎、飞书）可进入 Vercel 服务端；不能直连的来源（微信 / QQ / 钉钉消息）走第 28.8.3 节统一 JSON 导入。

#### 28.8.1 Zhihu 接入

知乎数据通过：

```text
Browser
↓
Zhihu OAuth
↓
Next.js Route Handler
↓
Zhihu Open API
↓
Persona Pipeline
↓
PostgreSQL
```

知乎 OAuth 凭证必须存储在 Vercel Environment Variables 中。

浏览器不得直接持有：

```text
OAuth App Secret
Access Secret
AI API Key
DATABASE_URL
```

知乎数据必须遵守官方 API、授权范围、数据使用规则和平台政策。

不得为了扩充 Persona Pool 而设计：

```text
批量抓取
无授权读取
绕过 API 限制
```

#### 28.8.2 Feishu 接入

飞书通过开放平台官方 API 接入，属于可进入 Vercel 的授权数据源：

```text
Browser
↓
Feishu OAuth
↓
Next.js Route Handler
↓
Feishu Open API
↓
Persona Pipeline
↓
PostgreSQL
```

要求与边界：

- 需在飞书开放平台创建自建应用，配置 app_id / app_secret，并开通 `im:message`、`im:chat` 等必要 scope。
- user_access_token 有有效期（约 2 小时），需 refresh_token 刷新；私聊会话需用户 token 换取 chat_id（官方 `/im/v1/chats` 不返回 P2P）。
- 只处理应用可见范围与用户授权范围内的数据；当前仅适配中国区 feishu.cn。
- 飞书 OAuth 凭证同样只存 Vercel Environment Variables，浏览器不得持有。

#### 28.8.3 统一 JSON 导入（微信 / QQ / 钉钉消息）

无法在服务端直连的消息来源，Web 端统一采用“用户上传导出 JSON”：

```text
Browser
↓
上传 JSON（微信 / QQ / 钉钉）
↓
Route Handler（白名单格式校验）
↓
归一化 / Speaker 清洗
↓
Persona Distillation
↓
PostgreSQL
↓
原始 JSON 删除
```

各来源归一化 Schema 与字段约定见《多平台数据接入方案.md》第 4 章。

### 28.9 环境变量

所有敏感配置使用：

> **Vercel Environment Variables**

例如：

```text
DATABASE_URL
AI_API_KEY

# 知乎 OAuth（统一 ZHIHU_ 前缀，与 zhihu-hackathon skill 命名对齐）
ZHIHU_APP_ID                # 开放平台 App ID（非 Secret，可放环境变量或服务端配置）
ZHIHU_OAUTH_APP_KEY         # OAuth App Key：换 /access_token 用
ZHIHU_ACCESS_SECRET         # 开放平台 Access Secret：用户数据接口 Authorization: Bearer

# 飞书开放平台（启用飞书接入时）
FEISHU_APP_ID
FEISHU_APP_SECRET
```

实际变量名可以根据代码统一调整，但不得把 Secret 写入：

```text
Git
前端代码
公开配置
README
```

> 注意：若旧文档出现 `ZHISHU_` 前缀，属拼写不一致，编码时统一以 `ZHIHU_` 为准并全局修正。

### 28.10 推荐项目目录

最终推荐：

```text
zhiyu/
├── app/
│   ├── page.tsx
│   ├── find/
│   ├── persona/
│   ├── agent-match/
│   ├── notify/
│   ├── profile/
│   └── api/
│       ├── auth/
│       ├── zhihu/          # Zhihu OAuth / API
│       ├── feishu/         # Feishu OAuth / API
│       ├── imports/        # JSON 上传解析 / 归一化 / speaker 清洗
│       ├── candidates/
│       ├── persona/
│       ├── matches/
│       └── notifications/
│
├── components/
│   ├── layout/
│   ├── sidebar/
│   ├── PersonaCard/
│   ├── MatchCard/
│   ├── AgentConversation/
│   ├── MatchReport/
│   └── charts/
│
├── lib/
│   ├── db/
│   ├── zhihu/
│   ├── feishu/
│   ├── importers/          # 各来源格式适配器
│   ├── ai/
│   ├── persona/
│   └── matching/
│
├── workflows/
│   ├── agent-match.ts
│   └── persona-pipeline.ts
│
├── types/
├── public/
├── prisma/              # 如果使用 Prisma
└── package.json
```

### 28.11 前后端职责边界

| 模块 | 运行位置 | 主要职责 |
|---|---|---|
| Next.js UI | Vercel | 页面与交互 |
| Route Handlers | Vercel | API 与业务入口 |
| PostgreSQL | 云数据库 | 持久化 |
| Vercel Workflows | Vercel | Agent 后台任务 |
| Zhihu API | 服务端调用 | 授权数据获取（公共人格） |
| Feishu API | 服务端调用 | 授权数据获取（职场人格） |
| Imports API | Vercel | JSON 上传解析 / speaker 清洗 / 归一化 |
| WeFlow | 用户本地 | 微信数据读取/导出/预处理 |
| QCE（QQ 导出工具） | 用户本地 | QQ 数据读取/导出/预处理 |
| 钉钉浏览器采集 | 用户本地 | 钉钉消息采集（辅助） |
| Distilly | 本地或服务端 Pipeline | Persona 蒸馏 |
| LLM | 服务端调用 | Agent / Judge |

### 28.12 一个重要原则

不要把系统设计成：

```text
前端
↓
直接调用所有服务
```

必须保持：

```text
浏览器
↓
Next.js
↓
Route Handler
↓
Service Layer
↓
Database / External API / Workflow
```

这样才能保证：

- Secret 不泄漏
- 权限集中处理
- 数据库访问统一
- Agent 任务可异步化
- 后续扩展更容易

---

## 29. 项目的核心创新点

不要把“使用 Distilly”作为核心创新。

### Innovation 1：Multi-source Persona

融合：

```text
私域人格
+
公共人格
+
显性人格
```

成为统一 Persona。

### Innovation 2：Persona Network

把传统社交平台中的“用户资料”升级为：

> **可计算、可检索、可被 Agent 理解的人格节点。**

### Innovation 3：Two-stage Matching

传统：

```text
推荐 → 人自己聊天
```

知遇：

```text
快速 Persona Match
↓
Agent Match
↓
真人决定
```

### Innovation 4：Agent-to-Agent Social Discovery

不是：

> 人找人。

而是：

> **Agent 先认识 Agent。**

### Innovation 5：Explainable Matching

不只告诉：

> 87%

还告诉：

> 为什么是这个人。

### Innovation 6：Persona ≠ Agent

> **海量 Persona 长期存在，Agent 按需实例化。**

---

## 29.1 最终部署原则

比赛版本默认：

> **GitHub → Vercel → Next.js 全栈应用**

不再采用：

```text
Vercel 前端
+
Render 后端
```

也不要求为了 MVP 单独部署 Node Worker。

推荐：

```text
GitHub
  ↓
Vercel
  ├── Next.js
  ├── Route Handlers
  ├── Vercel Workflows
  └── Environment Variables
          ↓
      PostgreSQL
```

只有当未来业务规模、任务类型或运行时需求明显超出 Vercel 能力时，才考虑把部分 Worker / AI Runtime 拆出。

比赛阶段不要过度工程化。

---

## 30. MVP 范围

比赛 Demo 不需要真的实现亿级数据。

MVP 只需要：

```text
10～1000 个 Persona
```

证明完整闭环：

```text
Persona
→
Match
→
Agent
→
Match Report
```

推荐 Demo 数据：

```text
真人 Persona：20～50
AI Persona：10～20
```

重点不是数据量，而是：

> **让评委看到一个用户从进入系统到获得“为什么这个人值得认识”的完整体验。**

---

## 31. MVP 必须实现的功能

### P0

- [ ] 用户创建 Persona
- [ ] SBTI 数据输入（内置测试）
- [ ] Persona 生成
- [ ] Persona 完整度
- [ ] 快速匹配
- [ ] 匹配分数
- [ ] 匹配原因解释
- [ ] Agent Match
- [ ] Agent-to-Agent 对话
- [ ] Match Report

### P1

- [ ] 微信数据导入（JSON 上传 + 工具指引）
- [ ] QQ 数据导入（QCE JSON）
- [ ] 飞书接入（OAuth / JSON 上传）
- [ ] 知乎数据接入（OAuth）
- [ ] 统一导入 / 归一化适配器
- [ ] AI 模型接入设置（BYOK：预设 / 自定义 + 延迟测试）
- [ ] Distilly 集成
- [ ] Persona Index
- [ ] 多种 Match Mode
- [ ] AI Persona

### P2

- [ ] 钉钉数据接入（文档 API / 消息上传）
- [ ] 桌面版自动获取（微信 / QQ / 钉钉消息）
- [ ] 大规模 Persona Network
- [ ] 邀请好友
- [ ] Persona 更新
- [ ] 长期人格变化
- [ ] 社区 Agent

---

## 32. 比赛 Demo 叙事

3 分钟 Demo 不应该从技术开始，而应该从问题开始：

> **“你有没有遇到过这样的人：看起来和你很像，但真正聊起来完全聊不来？”**

然后：

> “这是我的 Persona。”

↓

点击：

> **快速匹配**

↓

展示：

```text
兴趣 91%
思维 84%
互补 94%
```

↓

点击：

> **让 Agent 先聊聊**

↓

Agent A × Agent B

↓

生成：

> **你们不是最像的人，但是可能是最适合认识的人。**

↓

最后：

> **传统社交让人先认识人，再承担试错成本；知遇让 Agent 先替你认识一个人。**

---

## 32.1 AI Agent 开发必须遵守的技术栈

任何参与开发知遇的 AI Coding Agent 都必须默认以下技术路线：

```text
Next.js
+
React
+
TypeScript
+
Next.js Route Handlers
+
PostgreSQL
+
Prisma / Drizzle
+
Vercel Workflows
+
Vercel
```

除非项目负责人明确要求，不得擅自把项目改造成：

```text
Next.js + 独立 Express 后端
Next.js + FastAPI 后端
Vercel + Render 双后端
长期运行的自建 Agent Worker
```

### 开发原则

1. 页面优先使用 Next.js App Router。
2. API 优先使用 Route Handlers。
3. 数据统一进入 PostgreSQL。
4. 长时间 Agent 任务使用 Vercel Workflows。
5. Secret 只允许存在服务端环境变量。
6. Agent Match 必须异步执行。
7. Agent Match 的进度和结果必须持久化。
8. 用户关闭页面后，后台任务仍应能够继续。
9. WeFlow 保持在用户本地，不部署到 Vercel。
10. MVP 优先保证完整闭环，而不是提前实现亿级基础设施。

## 33. AI Agent 开发行为规范

任何参与开发知遇的 AI Agent 都必须遵循：

### 必须理解

```text
Persona ≠ Agent

Persona = 长期人格数据
Agent = 按需运行实例
```

### 必须理解

```text
快速匹配 ≠ Agent 匹配
```

快速匹配不调用 Agent 对话。

Agent Match 才调用 LLM。

### 必须理解

```text
海量 Persona ≠ 海量常驻 Agent
```

不得设计：

```text
Agent × Agent 全连接
```

必须采用：

```text
Vector Retrieval
+
Candidate Ranking
+
On-demand Agent
```

### 必须理解

Match Engine 是知遇的核心模块之一。

不要把整个产品简单实现成：

```text
LLM Chatbot
```

### 必须理解

匹配必须能够解释。

不能只返回：

```text
87%
```

必须说明：

```text
为什么匹配
哪里相似
哪里互补
为什么值得进一步认识
```

---

## 34. 数据与隐私原则

知遇涉及人格数据，因此必须优先考虑：

> Agent 与外部人格交流时的数据披露边界，见第 40 章《Agent 社交边界与数据披露规范》。

### 原始数据最小化

尤其是微信聊天记录，尽可能：

```text
本地处理
↓
人格蒸馏
↓
只上传必要 Persona
```

而不是：

```text
完整聊天记录
↓
服务器长期存储
```

### 真人与 AI 明确区分

必须存在：

```text
type = human
type = synthetic
```

不得让 AI Persona 冒充真人。

### Persona 可解释

用户应该知道：

> “系统为什么认为我是这样的人。”

### 公开创作者 Persona 边界

面向知乎大V 等公开创作者预置的人格，属于“真人公开资料合成”，与注册用户、AI 演示人格三者严格区分：

- 仅使用官方开放 API / 搜索接口可得的公开创作内容与公开简介，不采集他人点赞、关注、私信等关系或隐私字段。
- 全站显著标注“公开资料合成 · 非本人入驻 / 不代表本人”，人格结论附原文来源链接，并提供认领、申诉与下架入口。
- 公开 ≠ 无限制：批量抓取、无授权读取和超出 API 规则的再加工仍在禁止之列。

### 用户私有 LLM Key 最小暴露

用户在设置页自备的第三方 LLM API Key 属于用户私有配置：

- 只通过 HTTPS 提交，服务端加密后存储；任何响应只回显掩码（如后 4 位）。
- 完整 Key 不得进入前端持久化、日志、Git 或系统级环境变量说明。
- 延迟测试与实际调用均由服务端代理完成，浏览器不直连第三方 LLM。
- 与平台级 `AI_API_KEY` 严格分离（详见《AI模型接入设置方案.md》）。

---

## 35. 项目最终定义

如果 AI Agent 只能记住整个项目的十句话，应记住：

1. **知遇是 AI 驱动的人格匹配与兴趣社交平台。**
2. **核心理念是“让 Agent 先替你认识一个人”。**
3. **用户的数据来自微信 / QQ / 飞书 / 钉钉 / 知乎 / SBTI 等多类来源（均经本人授权），并融合成统一 Persona。**
4. **Distilly 负责把原始材料蒸馏成人格 Profile；它是基础设施，不是知遇的核心创新。**
5. **Persona 是长期存在的人格数据，Agent 是按需实例化的运行实例。**
6. **匹配分为“快速匹配”和“Agent 匹配”两个阶段。**
7. **快速匹配只使用 Persona / Embedding / 结构化特征，不进行 Agent 对话。**
8. **Agent 匹配只针对少量高价值候选，通过 5～8 轮人格探测式对话判断双方是否适合进一步认识。**
9. **未来可以拥有海量甚至亿级 Persona，但不是亿级常驻 Agent；通过 Persona Index + Vector Search + 按需 Agent 实例化实现规模化。**
10. **技术实现采用 Next.js 全栈 + Route Handlers + PostgreSQL + Vercel Workflows，并统一部署到 Vercel；WeFlow 保持本地运行。**

---

## 36. 一句话技术架构

> **知遇 = Next.js 全栈 + Route Handlers + PostgreSQL + Vercel Workflows + Multi-source Persona Fusion + Large-scale Persona Index + Two-stage Matching + On-demand Agent-to-Agent Discovery。**

中文：

> **知遇以 Next.js 为全栈应用基础，通过 Route Handlers 提供服务端 API，以 PostgreSQL 持久化用户、Persona 与匹配数据，以 Vercel Workflows 承载异步 Agent Match；在多源人格融合的基础上，通过快速匹配发现候选人，再通过按需实例化的 Agent-to-Agent 对话完成深度验证，最终把社交决策交还给真实的人。**

---

## 37. AI Coding Agent 执行前检查清单

任何 AI Coding Agent 开始写代码前，必须先确认：

### 产品层

- [ ] 理解 Persona ≠ Agent
- [ ] 理解快速匹配 ≠ Agent Match
- [ ] 理解 Match 必须可解释
- [ ] 理解真人 Persona 与 AI Persona 必须明确区分
- [ ] 理解最终目标是帮助真人降低认识陌生人的试错成本

### 技术层

- [ ] 使用 Next.js
- [ ] 使用 React + TypeScript
- [ ] API 使用 Route Handlers
- [ ] 数据使用 PostgreSQL
- [ ] ORM 使用 Prisma 或 Drizzle
- [ ] Agent 后台任务使用 Vercel Workflows
- [ ] 项目能够直接部署到 Vercel
- [ ] Secret 使用 Environment Variables
- [ ] WeFlow 不部署到 Vercel
- [ ] 不为了 MVP 引入不必要的独立后端

### Agent Match

- [ ] 创建 Match 后立即返回任务状态
- [ ] Workflow 在后台运行
- [ ] 页面关闭不影响任务
- [ ] Agent 对话结果持久化
- [ ] Judge 结果持久化
- [ ] 完成后创建 Notification
- [ ] 前端可以查询任务状态
- [ ] 失败任务具有明确错误状态

### 数据层

- [ ] User
- [ ] Persona
- [ ] Persona Source
- [ ] Match
- [ ] Agent Session
- [ ] Match Report
- [ ] Notification

这些核心对象都必须有清晰的数据模型和关系。

---

## 38. 禁止的架构方向

除非项目负责人明确要求，否则 AI Coding Agent 不得自行采用以下方案：

### 禁止 1：拆成两个独立项目

```text
frontend/
backend/
```

比赛 MVP 默认使用：

```text
一个 Next.js 全栈项目
```

### 禁止 2：Route Handler 同步等待完整 Agent 对话

错误：

```text
POST /api/match
↓
等待 8 轮 Agent 对话
↓
返回结果
```

正确：

```text
POST /api/match
↓
创建 Match
↓
启动 Workflow
↓
立即返回
↓
Workflow 后台执行
```

### 禁止 3：把 Agent 常驻数据库

错误：

```text
每个 Persona
↓
一个永久 Agent
```

正确：

```text
Persona
↓
按需创建 Agent Session
↓
任务结束
↓
保存 Report
```

### 禁止 4：前端保存 Secret

禁止：

```text
NEXT_PUBLIC_AI_API_KEY
NEXT_PUBLIC_DATABASE_URL
NEXT_PUBLIC_ZHIHU_SECRET
```

任何真正的 Secret 都不能暴露给浏览器。

### 禁止 5：为了亿级 Persona 过早复杂化

MVP 不要求：

```text
亿级真实 Persona
分布式向量集群
Agent 全连接网络
```

先证明：

```text
Persona
→
Match
→
Agent
→
Report
```

完整闭环。

---

## 39. 开发优先级

AI Coding Agent 的实现顺序建议固定为：

```text
1. Next.js 项目骨架
        ↓
2. PostgreSQL 数据模型
        ↓
3. 用户 / Persona
        ↓
4. 快速匹配 API
        ↓
5. Find 页面
        ↓
6. Match 创建 API
        ↓
7. Vercel Workflow
        ↓
8. Agent A ↔ Agent B
        ↓
9. Judge
        ↓
10. Match Report
        ↓
11. Notification
        ↓
12. Zhihu OAuth / Feishu OAuth（授权直连）
        ↓
13. 统一数据导入（JSON 上传 / 归一化 / speaker 清洗）
        ↓
14. Persona Pipeline（对接本地工具导出 + Distilly）
        ↓
15. UI 优化
        ↓
16. Vercel 部署
```

不要先花大量时间实现复杂的亿级 Persona 基础设施。

比赛版本的第一目标是：

> **让评委可以从登录开始，完整走通一次“Persona → Match → Agent → Match Report”的体验。**

---

## 40. Agent 社交边界与数据披露规范

### 40.1 目的与原则

Distilly 等蒸馏工具只负责把原材料蒸馏成 Person Profile / Agent Skill，**本身不提供隐私保护或社交边界机制**；边界必须由知遇实现。

三条最高原则：

1. **最小披露**：对外 Agent 对话只交流抽象人格特征，不交流事实细节。
2. **分层授权**：披露范围由用户显式控制，可随时调整。
3. **默认保守**：企业数据（飞书 / 钉钉等）默认不参与对外 Agent 对话。

### 40.2 数据分级与披露清单

| 层级 | 内容示例 | 可用于蒸馏 | 可进入 Agent 对话 prompt | 可写入 Match Report | 存储位置 |
|---|---|---|---|---|---|
| L0 私密原文 | 聊天原文、文档正文、Access Secret / API Key、未公开业务数据 | 仅作为蒸馏输入 | 永不 | 永不 | 本地处理；Web 上传用后即删；不长期存储 |
| L1 受限事实 | 公司名、项目名、客户名、财务 / 健康信息、联系方式、具体人名 | 可用于本地推断，必须先抽象化 | 永不（含非直述暗示） | 永不 | 加密存储，仅本人可见 |
| L2 抽象特征 | 兴趣、思维风格、沟通偏好、通用价值观、职业领域（无主体名） | 是 | 是（脱敏后） | 是 | Persona 结构化字段 |
| L3 公开信息 | 知乎公开创作、SBTI 自评结果、公开创作者资料 | 是 | 是 | 是（附来源） | Persona 字段 + 来源链接 |

任何一层数据都不得跨越其允许的去向；L0/L1 不得出现在 prompt、报告、通知 payload、日志与错误信息中。

### 40.3 披露等级（用户可控）

设置页 02「Agent 沟通偏好」在现有三个开关之外新增：

- **信息披露等级**：保守（默认）/ 标准 / 开放；
- **工作数据是否参与对外 Agent 对话**：默认关闭。

| 等级 | 对外可交流范围 |
|---|---|
| 保守（默认） | 仅 L2 中的通用兴趣、思维、沟通特征；不涉及任何可推断出 L1 的内容；企业数据完全不参与 |
| 标准 | L2 全部 + 职业领域（仅行业 / 职能，不含公司名、项目名） |
| 开放 | 用户显式授权后，可交流部分 L1 的抽象化描述（仍禁止具体主体名与联系方式） |

等级变更对后续对话立即生效；已生成的历史报告不回溯修改，但可被用户删除。

### 40.4 蒸馏阶段规则（Distilly / 本地 Pipeline）

1. 原材料只在本地（桌面版）或 Web 上传后的短期处理窗口内使用，处理完成后删除。
2. 蒸馏输出前必须经过 PII / 敏感实体清洗：
   - 具体人名 → 角色（如“一位同事”）；
   - 公司名 / 项目名 → 行业 / 职能（如“一家做企业服务的公司”）；
   - 金额、联系方式、健康信息 → 删除或量级化。
3. 产物只保存结构化 Persona 字段；`evidence` 默认只记录来源类型与本地指针，不保存原文。
4. 禁止把原始材料写入 Persona、Agent Skill、日志、通知与 Git。

### 40.5 Agent 对话阶段规则（Prompt 与输出）

1. **输入白名单**：构造 prompt 时只允许读取 L2/L3 字段（现有实现的 displayName / interests / topics / SBTI 类型符合此约束）。
2. **System prompt 禁区**：明确列出不得透露 L0/L1 内容，不得猜测、不得确认对方关于具体主体信息的判断。
3. **输出后置过滤**：对 Agent 回复做正则 + 模型复核，拦截公司名、项目名、联系人、金额、健康信息等实体；命中时改写或拒答，并记录脱敏后的安全事件。
4. **拒绝间接推断**：对“你是不是在 X 公司 / 做 Y 项目”这类确认式提问，统一回复“这类具体信息不在可交流范围内”，不做肯定或否定。
5. 对方 Agent 的诱导、套取行为同样被过滤；Judge 不把被拒答的内容计入匹配依据。

### 40.6 存储与第三方边界

- 平台只存储结构化 Persona、抽象 evidence、对话轮次与分数；原则上不存储对话原文。
- BYOK 调用属于第三方数据处理：调用前必须让用户知悉“prompt 不含 L0/L1”，供应商与数据处理风险由用户选择并确认。
- 平台级 `AI_API_KEY`（如有）只用于平台 AI Persona / 离线种子数据，不用于真人会话。
- 日志、错误信息与通知 payload 一律脱敏，不回显 prompt 原文或原始材料片段。

### 40.7 用户权利与审计

- 用户可随时查看 / 修改披露等级，删除数据源、Persona 及历史对话与报告。
- 公开创作者 Persona 保持“非本人入驻 + 认领 / 申诉 / 下架”机制（见 §21、§34）。
- 平台记录安全事件（何时、哪条规则、被拦截类型），仅本人与平台可见，不记录被拦截原文。

### 40.8 验收清单（开发与测试）

- [ ] 上传 / 蒸馏后的 Persona 扫描不到 L0/L1 原文（自动化敏感扫描）
- [ ] Agent prompt 构造只读取白名单字段（L2/L3）
- [ ] 输出过滤能拦截公司名、项目名、联系方式、金额等测试样例
- [ ] “工作数据参与对外对话”默认关闭，开启需二次确认
- [ ] Match Report、通知 payload、日志与错误信息中无原文引用
- [ ] 披露等级变更对后续对话生效
- [ ] 删除数据源 / Persona 后，相关 evidence、报告与对话摘要可被清除
