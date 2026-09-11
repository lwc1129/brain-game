# ISSUE_CANDIDATES.md

> **brain-game — Audit → Issue Candidate Extraction**
> 萃取日期：2026-09-11　·　基準：`PROJECT_AUDIT.md` @ `ce2b291`　·　分支：`claude/brain-game-audit-127z3l`
>
> ⚠️ **本文件不是 GitHub Issue，也不等同於已核准的工作項目。**
> 這是提供 **AIOS 審核用**的候選清單。每一項是否正式建立 GitHub Issue、是否合併、
> 是否降級為 backlog、是否不處理，**由 AIOS 決定，不由本文件決定**。
>
> 本輪**未修改任何產品程式碼、未建立任何 GitHub Issue、未建立 PR 或修復分支**。

---

## Candidate Summary

| ID | Candidate | Type | Severity | Blocking | Evidence Strength | AIOS Decision |
|---|---|---|---|---|---|---|
| IC-001 | 題庫自動更新的交付鏈斷裂：更新進 main 卻從未上線，CI 驗證亦從未執行 | DELIVERY | **P0** | YES | CONFIRMED | PENDING |
| IC-002 | 「返回主頁」後重玩造成同日重複計分與記憶體／儲存不一致 | BUG | **P1** | NO | CONFIRMED | PENDING |
| IC-003 | 題庫生成依賴已終止支援且未鎖版本的 `google-generativeai` | RELIABILITY | **P1** | NO | CONFIRMED | PENDING |
| IC-004 | 單題格式錯誤即導致整批題庫全滅，排程失敗率 23% | RELIABILITY | **P1** | NO | CONFIRMED | PENDING |
| IC-005 | 排程與部署失敗完全無告警，異常可數月無人察覺 | OBSERVABILITY | **P1** | NO | CONFIRMED | PENDING |
| IC-006 | 題庫只驗結構不驗難度，人工種題正被無審查 AI 題逐週替換 | DATA | **P1** | NO | STRONG | PENDING |
| IC-007 | 確認 production 的 AI 出題路徑是否實際啟用 | VALIDATION | **P1** | YES | NEEDS_VALIDATION | PENDING |
| IC-008 | 確認 GA4 是否啟用及是否存在真實使用數據 | VALIDATION | **P1** | YES | NEEDS_VALIDATION | PENDING |
| IC-009 | 使用者資料僅存於 localStorage，無匯出、無備份、無還原 | DATA | P2 | NO | CONFIRMED | PENDING |
| IC-010 | `js/app.js` 與 `js/render/*` 共 513 行零測試覆蓋 | TECH_DEBT | P2 | NO | CONFIRMED | PENDING |
| IC-011 | 前端 `logError` 無任何收集端，錯誤寫了等於沒人看得到 | OBSERVABILITY | P2 | NO | CONFIRMED | PENDING |
| IC-012 | 開發文件與實作脫節，已完成項目仍列為待辦、未實作章節寫得像已存在 | TECH_DEBT | P2 | NO | CONFIRMED | PENDING |
| IC-013 | 後端部署設定不在 repo 內（無 `vercel.json`），無法 review 或重建 | TECH_DEBT | P2 | NO | CONFIRMED | PENDING |
| IC-014 | 核心流程使用原生 `alert()`／`confirm()`，對銀髮族目標客群不友善 | UX | P2 | NO | CONFIRMED | PENDING |
| IC-015 | Gemini 配額的唯一防線為單實例記憶體限流 | RELIABILITY | P2 | NO | CONFIRMED | PENDING |

**Evidence Strength 定義**
`CONFIRMED` = 已由程式碼、測試、瀏覽器重現或 Actions 歷史直接證實
`STRONG` = 機制已由程式碼證實，影響程度為抽樣觀察
`PARTIAL` = 部分證實，仍有推論成分
`NEEDS_VALIDATION` = 尚未證實，需先取得外部資訊

---

# Group A｜立即需要 AIOS 決策

---

## IC-001｜題庫自動更新的交付鏈斷裂：更新進 main 卻從未上線，CI 驗證亦從未執行

### 類型
`DELIVERY`

### 嚴重度
`P0`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `update_questions.yml` 以 `GITHUB_TOKEN` 執行 `git push`（`.github/workflows/update_questions.yml:41`）。
2. `deploy.yml` 的觸發條件僅有 `push: branches: [main]` 與 `workflow_dispatch`
   （`.github/workflows/deploy.yml:3-6`），**沒有任何機制能接住上述 push**。
3. GitHub Pages 走的是 `upload-pages-artifact` + `deploy-pages` 路徑——`deploy.yml` 不執行，
   線上檔案就不會改變。
4. **2026-07-10 至 2026-09-09 之間共 61 天、8 次題庫 commit 進入 `main`，零次部署。**
5. `test.yml` 的觸發條件相同，因此**「`questions.json` 對前端 schema 的驗證」從未在任何一批
   AI 自動產生的題庫上執行過**。
6. 2026-09-09 人類 merge PR #30／#31 時，才把積壓 2 個月的題庫一次推上線。

### 證據

| 來源 | 內容 |
|---|---|
| Actions 歷史（Deploy to GitHub Pages） | 執行 #37 = `2026-07-10`；執行 #38 = `2026-09-09`。**中間無任何執行。** |
| Actions 歷史（Tests） | 執行 #30 = `2026-07-10`（push）；下一次 push 觸發為 `2026-09-09`。 |
| Git history | 期間進入 main 的題庫 commit：`1cc7863`(07-12)、`dd9f294`(07-19)、`99db365`(07-26)、`1a96101`(08-02)、`db6345e`(08-16)、`f5fada6`(08-23)、`d7be351`(08-30)、`75a7d94`(09-06) — 共 8 次 |
| `.github/workflows/update_questions.yml:32-42` | `git config user.name "github-actions[bot]"` → `git commit` → `git push`（使用預設 `GITHUB_TOKEN`） |
| `.github/workflows/deploy.yml:3-6` | `on: push: branches: [main]` / `workflow_dispatch`——無 `workflow_run` |
| `.github/workflows/test.yml:43-53` | `Validate questions.json against frontend schema` step 存在但從未在自動更新 commit 上執行 |
| GitHub 官方行為 | 以 `GITHUB_TOKEN` 推送的 commit 不觸發 workflow（防遞迴機制） |

### 使用者 / 產品影響

- README 與 UI 文案（`js/render/helpers.js:48`：「每週自動更新，近期出過的題目不重複」）
  對使用者做出的承諾，**在使用者端不成立**。
- 老玩家實際遇到的題目重複率**高於設計預期**：前端的「近期 60 題排除」是設計來搭配
  每週新題流入的，題庫實際凍結後，排除機制只是在同一批舊題裡輪轉。
- 這是產品**唯一的內容更新管道**。它斷了，產品內容就是靜止的。

### 技術影響

- **Deployment**：repo 的 `main` 與 production 的實際內容可能長期不一致，且**沒有任何機制會回報**。
  任何人看 Git history 都會誤以為題庫每週有在更新。
- **Reliability**：`test.yml` 的 schema 驗證對自動產生內容失效。目前僥倖沒出事，
  是因為 Python 端 `validate_questions` 與前端 `isValidQuestionBank` 的規則恰好等價；
  **兩邊一旦漂移，壞掉的題庫會直接進 main 且無人察覺**（此風險與 IC-003／IC-004 疊加）。
- **Maintainability**：任何題庫相關的改善工作，在此修復前都無法送達使用者、也無法驗證成效。

### 建議處理方向

調整 GitHub Actions 的觸發關係，使題庫更新 workflow 成功完成後能觸發既有的部署 workflow，
並確保排程失敗時不會觸發部署。需一併確認自動更新的 commit 也會經過既有的 schema 驗證。
**不建議**改用 PAT 推送——那等於為了繞過 GitHub 的防遞迴安全機制而放寬權限。

### 是否阻塞其他工作
`YES` — IC-004 與 IC-006 的任何成果在此修復前都不會出現在使用者端，等於無法驗證。

### 建議優先序理由

這是整份 Audit 中唯一「招牌功能對使用者已實質失效」且已持續 61 天的問題。
改動範圍侷限於 workflow YAML，不觸碰產品程式碼，風險極低而驗證方式客觀。
它同時是其他題庫類工作的前置條件。

### AIOS 需要決定

1. **是否核准正式開立 Issue，並列為最高優先**。
2. 是否要求同一 Issue 內一併涵蓋「自動更新 commit 也需通過 `test.yml` 驗證」，
   或拆為獨立追蹤項（本文件判斷兩者屬同一交付鏈斷點，已合併為一個 Candidate）。
3. 是否要求在修復中一併加入「部署後驗證線上內容與 repo 一致」的檢查步驟，
   或交由 IC-005 處理。

---

## IC-002｜「返回主頁」後重玩造成同日重複計分與記憶體／儲存不一致

### 類型
`BUG`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. 完成頁的「← 返回主頁」handler（`js/app.js:229-232`）只做兩件事：
   `_data.completed = false` 與 `renderStep()`。
2. 它**沒有呼叫 `saveTodayData`**，因此 localStorage 中的 `completed` 仍為 `true`
   → 記憶體與儲存體不一致，此時重整頁面會「跳回」完成頁。
3. 它**沒有呼叫 `revertDailyResult`**，因此當日成績未被撤銷。
4. `applyDailyResult`（`js/logic.js:110-111`）每次呼叫都無條件
   `next.total += score` 且 `next.log.push({ date: today, ... })`，**不檢查當日是否已有記錄**。
5. 結果：完成 → 返回主頁 → 重玩 → 完成，**同一天被計分兩次、產生兩筆記錄**。
6. 連帶使 `累積天數`（`js/render/helpers.js:17` 的 `hist.log.length`）不再等於相異天數。
7. **同一函式內的「重新挑戰」路徑（`js/app.js:233-243`）做對了全部這些事**：
   `revertDailyResult` → `bumpAiRetryVersion` → `clearInflight` → 重置 `_data` →
   `saveTodayData` + `saveHistory`。兩條路徑的處理不一致。

### 證據

| 來源 | 內容 |
|---|---|
| **Browser reproduction**（Chromium headless + Playwright 1.56.1） | 完整重現，見下方 |
| `js/app.js:229-232` | `() => { _data.completed = false; renderStep(); }` — 缺 save、缺 revert |
| `js/app.js:233-243` | 對照組：retry 路徑正確呼叫 `revertDailyResult` + 兩個 save |
| `js/logic.js:110-111` | `next.total += score;` / `next.log.push({ date: today, ... })` — 無同日冪等保護 |
| `js/render/helpers.js:17` | `${hist.log.length}` 標示為「累積天數」 |
| Test result | 現有 78 個 JS 測試**全數通過**——此缺陷完全在測試覆蓋範圍之外（見 IC-010） |

**重現紀錄（實測輸出）：**
```
完成一次後 history: {"total":20,"streak":1,"lastDate":"2026-09-11",
                     "log":[{"date":"2026-09-11","steps":5000,"correct":2,"score":20}]}
返回主頁後 localStorage.completed = true          ← 記憶體已改 false，未落地
第二次完成後 history: {"total":30,"streak":1,"lastDate":"2026-09-11",
                     "log":[{"date":"2026-09-11",...,"score":20},
                            {"date":"2026-09-11",...,"score":10}]}   ← 同一天 2 筆
畫面顯示：30 累積分數 ／ 🔥1 連續達標天 ／ 2 累積天數   ← 一天卻算 2 天
```

### 使用者 / 產品影響

- 使用者看到的**累積分數會灌水**，「累積天數」會**把一天算成兩天**。
- 對銀髮族產品而言，「數字不對」等同於「這個東西壞了」——而這些數字正是產品的黏著機制。
- **錯誤的資料只存在使用者自己的 localStorage，沒有伺服器可以修正**（見 IC-009）。
  一旦被污染，除了叫使用者清除瀏覽器資料（連同全部歷史一起失去）之外沒有救援手段。
- 另一個較輕但可感知的症狀：按了「返回主頁」之後重整，畫面會跳回完成頁，
  使用者會覺得「我明明按了返回」。

### 技術影響

- **Data**：`history` 的 `log` 失去「每日一筆」的不變量，`total` 與 `log.length` 都不再可信。
  任何未來基於歷史資料的功能（統計、圖表、成就）都會建立在有缺陷的資料上。
- **Architecture**：暴露出 `js/app.js` 的模組級可變狀態沒有單一 commit point——
  `_data` 可以被任意路徑修改卻不落地。這是 PROJECT_AUDIT.md 標記為「prototype 寫法」的部分。
- **Maintainability**：兩條語意相近的路徑（返回／重試）各寫各的，是同類缺陷的溫床。

### 建議處理方向

兩種方向，建議由 AIOS 選擇或要求併用：
- **方向 A（對症）**：讓「返回主頁」與「重新挑戰」共用同一條「撤銷當日結果」路徑，
  確保記憶體與 localStorage 一致。
- **方向 B（防禦）**：在計分函式層加入「同日冪等」保護——偵測 log 已有當日記錄時先移除舊筆再寫入。
  此方向同時擋掉未來所有可能繞過的路徑，並順帶修正「累積天數」的語意。

無論採哪個方向，**建議要求隨修復附上對應的回歸測試**（與 IC-010 相關）。

### 是否阻塞其他工作
`NO` — 此缺陷走一般 push 路徑，人類 merge 會正常部署，不受 IC-001 的交付斷點阻塞，可獨立進行。

### 建議優先序理由

已重現、影響使用者直接看到的核心數字、且資料損壞不可從伺服器端修復。
修法有現成的正確範本（同檔案的 retry 路徑），改動範圍可控。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. 採方向 A、方向 B、或兩者併用（方向 B 額外修正「累積天數」語意，範圍略大）。
3. 是否要求與 IC-010（測試缺口）綁為同一個 Issue 交付，或僅要求本 Issue 附帶回歸測試、
   IC-010 另行追蹤。

---

## IC-003｜題庫生成依賴已終止支援且未鎖版本的 `google-generativeai`

### 類型
`RELIABILITY`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `update_questions.yml:25` 執行 `pip install google-generativeai`，**未指定任何版本**。
2. 該套件已由上游宣告**終止支援**。GitHub Actions log 中每次執行都會輸出警告原文。
3. 這是題庫擴充的**唯一** SDK 路徑（`generate_questions.py:call_gemini`）。
4. 前端 proxy（`api/questions.js`）走的是原生 `fetch` + REST，**不受此套件影響**——
   兩條 Gemini 路徑的依賴狀況不同。

### 證據

| 來源 | 內容 |
|---|---|
| Actions log（run `31331920146`，2026-08-09） | `All support for the google.generativeai package has ended. It will no longer be receiving updates or bug fixes. Please switch to the google.genai package as soon as possible.` |
| `.github/workflows/update_questions.yml:25` | `run: pip install google-generativeai`（無版本鎖定） |
| `generate_questions.py:319` | `import google.generativeai as genai`（函式內 import） |
| `api/questions.js:144-161` | 對照：proxy 端使用原生 `fetch` 呼叫 REST endpoint，無 SDK 依賴 |

### 使用者 / 產品影響

題庫會在某個週日凌晨**無聲凍結**。依 IC-005（無告警）與 IC-001（無部署）的現況，
這件事**可能好幾個月後才會有人發現**——正如題庫已經 61 天沒上線卻無人察覺一樣。
使用者端的症狀是題目重複率持續上升，但不會有任何錯誤訊息。

### 技術影響

- **Reliability**：未鎖版本代表每週排程都在抓最新版。上游任何 breaking change
  或套件下架都會直接讓排程失敗，且時間點不可預測。
- **Maintainability**：終止支援的套件不再收到 bug fix 與安全修補。
- **Architecture**：兩條 Gemini 整合路徑（Python SDK vs Node `fetch`）技術選擇不一致，
  遷移時可考慮是否收斂。

### 建議處理方向

將題庫生成腳本遷移至上游建議的後繼套件，並在 workflow 中鎖定套件版本（至少鎖 major）。
遷移時需確認既有的 42 個 Python 測試仍全數通過——測試目前以 mock 覆蓋
`parse_response_text` / `validate_questions` / `merge_question_banks`，與 SDK 呼叫解耦，
理論上遷移面是侷限的。

### 是否阻塞其他工作
`NO` — 目前排程仍能運作，不阻塞其他工作；但它是「題庫永久凍結」這個最高機率風險的根源。

### 建議優先序理由

機率高（未鎖版本＋已終止支援）、衝擊高（唯一內容更新管道）、
且失效時無人會知道（IC-005 尚未處理）。三者疊加使它的實際風險高於單看嚴重度。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. **是否與 IC-004 合併為單一「題庫生成管線韌性」Issue**。
   本文件判斷兩者 root cause 不同（依賴遷移 vs 驗證策略）、implementation 不同、
   verification 也不同，故先行拆開；但兩者都改動 `generate_questions.py` 與同一個 workflow，
   AIOS 可能認為合併交付更有效率。
3. 是否要求遷移時一併收斂兩條 Gemini 整合路徑（範圍會明顯放大，本文件不建議在此輪進行）。

---

## IC-004｜單題格式錯誤即導致整批題庫全滅，排程失敗率 23%

### 類型
`RELIABILITY`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `generate_questions.py:main()` 在 `merge_question_banks` **之前**呼叫
   `validate_questions(new_data)`（`generate_questions.py:344`），
   而 `validate_questions` 對任何一題不合格即 `raise ValueError`。
2. 因此 **Gemini 回傳的 30 幾題中只要有 1 題格式不對，整批新題全數丟棄**，
   `questions.json` 完全不更新，workflow 以 exit code 1 結束。
3. **13 次排程中 3 次完全失敗**（2026-06-21、2026-06-28、2026-08-09），失敗率 23%。
4. 2026-08-09 的失敗原因已確認為單一題目的格式問題，而非 API 或網路故障。
5. 現有的 `merge_question_banks` 內部**已經有**逐題健全性檢查
   （`_is_mergeable_question`，會靜默跳過不合格的題目）——
   也就是說「部分接受」的能力已經存在於程式碼中，只是被前置的整批驗證擋在前面。

### 證據

| 來源 | 內容 |
|---|---|
| Actions log（run `31331920146`，2026-08-09） | `題庫產生失敗，不更新 questions.json：難度 hard 第 2 題的正確答案 a 不在 opts 選項中` → `Process completed with exit code 1` |
| Actions 歷史（每週自動更新題庫） | 13 次執行，conclusion = `failure` 者：run #2（06-21）、#3（06-28）、#9（08-09） |
| `generate_questions.py:344` | `validate_questions(new_data)` — 在合併前對整批新題做全有全無驗證 |
| `generate_questions.py:validate_questions` | 任一題不合格即 `raise ValueError`，無部分接受路徑 |
| `generate_questions.py:_is_mergeable_question` | 已存在的逐題檢查（合併時靜默跳過壞題）——能力已具備 |

### 使用者 / 產品影響

每 4 次週更新就有約 1 次**完全沒有新題進入題庫**，而失敗原因往往只是 LLM 在
30 幾題中寫錯了 1 題。使用者端的直接後果是題目更新頻率遠低於「每週」的承諾
（與 IC-001 疊加後，實際更新頻率是零）。

### 技術影響

- **Reliability**：把 LLM 輸出的正常變異（偶發格式偏差）當成致命錯誤處理，
  使整條管線的成功率被最差的單一題目決定。
- **Data**：矛盾的是，這個嚴格策略反而**沒有**保護到題庫品質——
  它只擋格式，不擋語意與難度（見 IC-006）。
- **Maintainability**：`merge_question_banks` 已有逐題過濾能力，卻與 `main()` 的
  整批驗證策略不一致，是兩套並存的驗證哲學。

### 建議處理方向

將「新題的驗證」與「合併後題庫的驗證」分離：新題採逐題過濾（丟掉壞題、保留好題，
並記錄被丟掉的數量與原因），合併後的完整題庫仍維持嚴格的整批驗證以確保寫出的檔案永遠合法。
需同時考慮「過濾後剩餘題數過少」時的處理策略。

### 是否阻塞其他工作
`NO` — 但與 IC-001 疊加時，題庫實際更新率接近零。

### 建議優先序理由

23% 的失敗率是已量化的事實，且修復方向明確、既有程式碼已具備所需能力。
它直接決定「每週更新」這個產品承諾的達成率。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. **是否與 IC-003 合併**（兩者同檔案、同 workflow，但 root cause 與 verification 不同）。
3. 是否要求定義「過濾後題數不足」的門檻與行為（例如少於 N 題時仍視為失敗），
   這會影響 Issue 的範圍。

---

## IC-005｜排程與部署失敗完全無告警，異常可數月無人察覺

### 類型
`OBSERVABILITY`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `update_questions.yml` 失敗時**沒有任何通知機制**——沒有 Slack、沒有 email、沒有自動開 issue。
   失敗紀錄只留在 GitHub Actions 頁面。
2. 3 次排程失敗（2026-06-21、06-28、08-09）**無任何後續處理痕跡**：
   沒有對應的 issue、沒有 commit、沒有人工補跑。
3. `CLAUDE.md` §6 明文規定了異常偵測閾值、自動開 issue 格式（含 Title／Body／Labels）
   與 hot-fix 協議，**整章完全沒有對應實作**——repo 內無任何相關 workflow、無任何 named constant。
4. **repo 內已有可直接參考的成功範例**：`ai-pr-review.yml:131-148` 的 `slack-notify` job
   使用 `SLACK_WEBHOOK_URL` 在 PR review 完成後發送通知，且 `if: always()`。
5. IC-001 的 61 天部署斷線之所以能持續那麼久，直接原因就是沒有任何機制會回報異常。

### 證據

| 來源 | 內容 |
|---|---|
| `.github/workflows/update_questions.yml` 全檔 | 42 行，無任何 notification／issue 建立步驟；失敗即靜默結束 |
| Actions 歷史 | 3 次 `conclusion: failure`，且 repo 的 issue 總數為 **0**（`list_issues` 回傳 `totalCount: 0`） |
| `CLAUDE.md` §6 | 定義了「Gemini 服務中斷：5 分鐘內 502 比率 > 10%」「濫用攻擊：短時間大量不同 IP 觸發 429」等閾值與自動開 issue 格式 |
| `grep` 全 repo | 上述閾值無任何 named constant 實作；無異常偵測 workflow |
| `.github/workflows/ai-pr-review.yml:131-148` | 現成可參考的 Slack 通知 job |

### 使用者 / 產品影響

異常的**平均發現時間目前是「直到有人剛好去看」**。實測案例：
題庫 61 天沒上線、排程失敗 3 次，都沒有任何人察覺。
對一個宣稱「無人值守」的專案，這代表所謂的無人值守實際上是「無人知情」。
使用者端的症狀（題目一直重複）不會被任何人回報，因為產品刻意不對使用者顯示錯誤。

### 技術影響

- **Reliability**：所有自動化流程目前都是 fire-and-forget，沒有回饋迴路。
- **Deployment**：無法確認部署是否真的發生、線上內容是否與 repo 一致。
- **Maintainability**：`CLAUDE.md` §6 描述了一套不存在的維運機制，
  使文件對接手者產生誤導（與 IC-012 相關）。

### 建議處理方向

先建立最小可用的失敗回饋迴路：讓題庫更新與部署 workflow 在失敗時發出通知
（可直接沿用 repo 內既有的 Slack 通知模式）。
至於 `CLAUDE.md` §6 完整描述的「異常偵測閾值 + 自動開 issue + 自動 hot-fix」是否要完整實作，
屬於範圍決策，建議與 IC-012 一併考慮（若不實作，應修正文件定位而非讓它繼續看起來像已存在）。

### 是否阻塞其他工作
`NO` — 但它是「異常長期無人察覺」這個模式的根源。在 IC-001 修復後，
若無此機制，下一次交付鏈斷裂仍會重演同樣的長期靜默。

### 建議優先序理由

它本身不造成故障，但它是**所有其他故障得以長期存在的原因**。
IC-001 的 61 天與 IC-004 的 3 次失敗都是它的直接後果。實作成本低（repo 內有現成範本）。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. 範圍：只做「失敗通知」這個最小迴路，或要求完整實作 `CLAUDE.md` §6
   （含閾值偵測與自動開 issue）。本文件建議先做前者。
3. 通知管道：沿用既有的 `SLACK_WEBHOOK_URL`，或改用 GitHub issue／email。
4. 若決定不完整實作 §6，是否要求一併調整 `CLAUDE.md` 的定位（可併入 IC-012）。

---

## IC-006｜題庫只驗結構不驗難度，人工種題正被無審查 AI 題逐週替換

### 類型
`DATA`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `questions.json` 的**四個難度皆已達 300 題上限**
   （`MAX_PER_DIFFICULTY = 300`，`generate_questions.py:42`）。
2. `merge_question_banks` 以 `combined[-MAX_PER_DIFFICULTY:]`
   （`generate_questions.py:310`）截斷——**新題進幾題，最前面（最舊）就被淘汰幾題**。
3. 最舊的題目正是 `seed_questions.py` 產生的人工種題。近 5 次排程每次汰換約 30 題。
4. 驗證**只檢查結構**（型別、4 個選項、答案在選項中、選項互異），
   `validate_questions` 與 `isValidQuestion` **都不檢查語意正確性，也不檢查難度是否符合所屬級別**。
5. 抽樣檢視 `hard` 難度最新題目，確認存在明顯不符難度的題目（見證據）。
6. 難度分級是產品的核心機制：`getDiff`（`js/logic.js:34-39`）以步數決定難度，
   這是產品唯一的原創設計。

### 證據

| 來源 | 內容 |
|---|---|
| `questions.json` 實際統計 | `hard` / `medium` / `easy` / `super_easy` 各 **300 題**（皆達上限）；題文零重複、跨難度零重複 |
| `generate_questions.py:42` | `MAX_PER_DIFFICULTY = 300` |
| `generate_questions.py:310` | `merged[diff] = combined[-MAX_PER_DIFFICULTY:]` — 先進先出淘汰 |
| Git `--stat`（近 5 次排程） | 每次 `questions.json` 變動約 270–326 行插入／等量刪除，即每次汰換約 30 題 |
| **抽樣**：`hard` 最新題目 | 「如果一隻青蛙有兩張嘴，那麼十隻青蛙會有幾張嘴？」— 屬 `super_easy` 級 |
| **抽樣**：`hard` 最新題目 | 「小明比小華高，小華比小美高，誰最高？」— 屬 `super_easy` 級 |
| **抽樣**：`super_easy` 最新題目 | 「找出數列的下一個數字：2, 2, 2, 2, ?」— 退化題，無認知訓練價值 |
| `js/logic.js:145-158` / `generate_questions.py:validate_questions` | 兩份驗證器皆只做結構檢查 |

> Evidence Strength 標為 `STRONG` 而非 `CONFIRMED`：淘汰機制與驗證範圍已由程式碼與 commit 統計**完全證實**；
> 「難度校準失效的普遍程度」則來自抽樣觀察，未做全題庫量化評估。

### 使用者 / 產品影響

- **產品唯一的原創機制正在失效**。若走 1,000 步拿到的「困難」題和走 8,000 步拿到的
  「超簡單」題一樣簡單，步數 ↔ 難度的耦合就不成立，產品退化為「隨機腦力測驗網站」，
  失去差異化。
- 對認知訓練這個用途而言，難度不對意味著訓練強度不對——對認知退化程度不同的長輩，
  題目過難會挫折、過易則無訓練價值。
- 照目前汰換速率推算，`seed_questions.py` 產出的人工題庫會在數十週內被完全替換為
  **沒有經過任何人審閱**的 AI 輸出。

### 技術影響

- **Data**：題庫的品質基準線正在單調下降，且**沒有任何機制會偵測到**。
  結構驗證全綠並不代表內容可用。
- **Architecture**：目前的上限＋FIFO 設計隱含了一個未經確認的產品決策
  （「AI 產的最終應全面取代人工種題」）。
- **Maintainability**：`seed_questions.py`（718 行）作為可重現的人工基準線，
  一旦題庫被完全替換就失去對照價值。

### 建議處理方向

方向需要 AIOS 先做產品決策（見下），可能的技術方向包含：為各難度加入可自動檢查的
難度 heuristic（例如運算位數、步驟數、選項語意距離），或在淘汰策略上保護一批人工基準題，
或引入抽樣人工審查關卡。**本文件不建議在決策前選定實作方向。**

### 是否阻塞其他工作
`NO` — 但受 IC-001 阻塞：在交付鏈修復前，任何題庫品質改善都不會送達使用者。

### 建議優先序理由

它侵蝕的是產品唯一的差異化機制，且退化是持續且不可逆的（被淘汰的人工題不會回來）。
但它不是立即故障，且正確的處理方向取決於一個尚未回答的產品決策。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. **先回答一個產品問題**：題庫最終要長成全 AI 產的，還是要保留人工品質基準？
   目前的 FIFO 淘汰機制預設了前者——這**是刻意的設計，還是 `MAX_PER_DIFFICULTY`
   上限的意外副作用？** 答案決定 Issue 的範圍與方向。
3. 是否要求先做一次全題庫的難度分布量化評估（把 Evidence Strength 從 `STRONG`
   提升到 `CONFIRMED`）再決定實作方向。
4. 優先序是否應與 IC-008 的結果綁定——若目前無真實使用者，內容品質的急迫性較低。

---

# Group C｜需要先驗證

> 以下項目**尚未確認事實**，依規則不列為 BUG。它們的價值在於：
> 在取得答案之前，數個其他 Candidate 的優先序無法正確判定。

---

## IC-007｜確認 production 的 AI 出題路徑是否實際啟用

### 類型
`VALIDATION`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `js/config.js:8` 提交值為 `AI_PROXY_URL: ''`（空字串）——這是**刻意的設計**，
   由 `deploy.yml:44-48` 在部署時以 GitHub Repository Variable 注入。
2. `js/ai.js:11-13` 的 `aiEnabled()` 在 `AI_PROXY_URL` 為空時回傳 `false`，
   前端會**靜默**改用題庫出題，使用者完全無感。
3. **`AI_PROXY_URL` 這個 Repository Variable 是否已設定，無法從 repository 本身判斷。**
4. repo 內**無 `vercel.json`**，也無任何 Vercel 部署紀錄——後端是否仍在運作無從查證。
5. 涉及的程式碼規模：`api/questions.js`（281 行）+ `js/ai.js`（64 行）+
   `js/render/loading.js`（19 行）+ 39 個相關測試（proxy 32 + ai 7）。
6. 本次 Audit 的執行環境 egress proxy 封鎖 `lwc1129.github.io`，**無法代為驗證**。

### 證據

| 來源 | 內容 |
|---|---|
| `js/config.js:3-9` | `GA_MEASUREMENT_ID: ''` / `AI_PROXY_URL: ''` + 註解「部署時由 CI 注入實際值」 |
| `.github/workflows/deploy.yml:44-48` | `if [ -n "${AI_PROXY_URL}" ]` → `sed -i` 注入；未設定時保留空值 |
| `js/ai.js:11-13` | `export function aiEnabled() { return Boolean(CONFIG.AI_PROXY_URL); }` |
| `js/app.js:153-166` | `aiEnabled()` 為 false 時直接 `pickFromBank`，無任何使用者可見訊息 |
| repo 檔案清單 | 無 `vercel.json` |
| 本次驗證嘗試 | `curl https://lwc1129.github.io/brain-game/js/config.js` → `CONNECT tunnel failed, 403`（環境限制，非產品問題） |

### 使用者 / 產品影響

**目前無法判定。** 兩種可能的世界差異極大：
- 若已啟用：AI 即時出題是產品的核心差異化功能，其可靠性（IC-015、限流）應被認真對待。
- 若未啟用：上述 364 行程式碼與 39 個測試在 production 全是 **dead code**，
  而「AI 出題」的 UI（Loading 動畫、來源標籤、`source-banner-ai`）永遠不會被使用者看到。

**在回答之前，無法正確排定 IC-015 以及任何 AI 相關工作的優先序。**

### 技術影響

`無重大技術影響` — 本項為資訊蒐集，不涉及程式碼變更。
但其結果會直接影響對 `api/` 整層的維護投入判斷。

### 建議處理方向

取得三項事實即可：
1. GitHub Repository Variable `AI_PROXY_URL` 是否已設定（Settings → Secrets and variables → Actions → Variables）。
2. 線上 `js/config.js` 的實際內容（`curl https://lwc1129.github.io/brain-game/js/config.js`）。
3. 若已設定：Vercel 專案是否仍存在、`GEMINI_API_KEY` 是否仍有效
   （對 proxy 發一次合法 origin 的 POST 即可判定）。

**注意：這是驗證動作，不是修復。** 依本階段規則，不應在此展開任何修復工作。

### 是否阻塞其他工作
`YES` — IC-015 的優先序、以及是否值得投入維護 `api/` 整層，都取決於本項結果。

### 建議優先序理由

成本極低（三個查詢動作），但結果會改變數個其他 Candidate 的優先序。
在未知狀態下投入 AI 相關工作有相當機率是白做。

### AIOS 需要決定

1. **是否先執行此驗證，再審核 IC-015 與其他 AI 相關項目**。
2. 由誰執行（需要 repo settings 與 Vercel 控制台的存取權，非本 session 能力範圍）。
3. 驗證結果若為「未啟用」，是否要將此轉為一個產品決策項
   （要啟用 AI，還是移除相關程式碼？）——屆時應為新的 Candidate，不在本文件範圍。

---

## IC-008｜確認 GA4 是否啟用及是否存在真實使用數據

### 類型
`VALIDATION`

### 嚴重度
`P1`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `js/analytics.js` 已實作 GA4 初始化與 5 個事件：
   `start_game`、`answer_question`、`complete_game`、`retry_game`、`share_result`。
   事件參數設計完整（含 `difficulty_level`、`source`、`is_correct`、`steps`）。
2. `js/analytics.js:4` 在 `GA_MEASUREMENT_ID` 為空時直接 `return`，不載入任何腳本。
3. `GA_MEASUREMENT_ID` 由 `deploy.yml:39-43` 從 GitHub Secret 注入，
   **是否已設定無法從 repository 判斷**。
4. repo 內**沒有任何使用數據的紀錄**：無 analytics 快照、無 issue、無使用者回饋、
   無留存或 DAU 的任何痕跡。
5. Git history 顯示 2026-07-10 至 2026-09-09 這 61 天**只有機器人的題庫 commit，
   沒有任何人類開發活動**——專案近期的投入狀態不明。

### 證據

| 來源 | 內容 |
|---|---|
| `js/analytics.js:3-15` | `if (!CONFIG.GA_MEASUREMENT_ID) return;` → 未設定即完全停用 |
| `js/analytics.js:17-22` | `trackEvent` 在 `window.gtag` 不存在時直接 return |
| `js/app.js:168, 184, 195, 235, 244` | 5 個事件的實際埋點位置，參數完整 |
| `.github/workflows/deploy.yml:39-43` | GA ID 由 Secret 注入 |
| GitHub API | repo issue 總數 = 0；無任何使用者回饋管道 |
| Git history | 2026-07-10 → 2026-09-09 僅有 `github-actions[bot]` 的題庫 commit |

### 使用者 / 產品影響

**目前無法判定產品有沒有使用者。** 這個答案決定了整個後續工作的性質：
- 若有穩定使用者（例如 50 個家庭）：IC-002 的資料錯誤、IC-006 的內容品質都是**急迫**的。
- 若目前是 0 個使用者：上述問題的急迫性大幅下降，
  而「找到第一批使用者」才是真正該做的事——**修再多 bug 也不會有人受益**。

PROJECT_AUDIT.md 將產品階段判定為 MVP，而 MVP → PILOT 的關鍵條件正是
「一組真實使用者 + 2 週留存資料」。沒有本項答案，無法判斷是否已達標。

### 技術影響

`無重大技術影響` — 本項為資訊蒐集，不涉及程式碼變更。

### 建議處理方向

取得兩項事實：
1. GitHub Secret `GA_MEASUREMENT_ID` 是否已設定（或直接看線上 `js/config.js`，
   可與 IC-007 同一次驗證完成）。
2. 若已設定：取得 GA4 的基本數據快照——DAU、
   `start_game` → `complete_game` 的完成率、7 日留存。

**注意：這是驗證動作，不是修復。**

### 是否阻塞其他工作
`YES` — IC-006、IC-009、IC-014 的嚴重度判定都取決於「是否有真實使用者」。
在無使用者的情況下，這三項的優先序應顯著下調。

### 建議優先序理由

成本極低（可與 IC-007 同一次完成），但它是**判斷「該修品質還是該找使用者」的唯一依據**。
在沒有這個答案的情況下排定 roadmap，風險是把資源投在沒有人使用的產品上。

### AIOS 需要決定

1. **是否先執行此驗證，再審核 Group A 中與內容品質／體驗相關的項目**（IC-006、IC-014）。
2. 若 GA 未啟用：是否要將「啟用 GA 並取得第一批數據」列為獨立的產品工作
   （屆時應為新的 Candidate）。
3. 若已啟用但數據顯示無使用者：是否要求重新檢視整份 roadmap 的方向
   （從「修品質」轉向「找使用者」）。

---

# Group B｜可排入 Backlog

> 以下均為**已確認**且有實際影響的項目，但目前不阻塞 production 或核心流程。

---

## IC-009｜使用者資料僅存於 localStorage，無匯出、無備份、無還原

### 類型
`DATA`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. 產品**沒有任何後端資料庫**。`api/questions.js` 是無狀態的 AI 代理，不儲存任何使用者資料。
2. 全部使用者資料（累積分數、連續達標天數、歷史記錄）只存在瀏覽器 localStorage
   的 `brain-game:history` 這一個 key。
3. **沒有匯出、沒有匯入、沒有備份、沒有跨裝置同步**。
4. 換手機、換瀏覽器、清除瀏覽器資料 = 全部歸零，且使用者**無任何自救手段**。
5. 已實測確認：同裝置同瀏覽器的重整可正確續存（含答到一半的狀態）。

### 證據

| 來源 | 內容 |
|---|---|
| `js/storage.js:42-48` | `loadHistory` / `saveHistory` — 唯一的持久化路徑，來源為 localStorage |
| `api/questions.js` 全檔 | 無任何資料寫入；request body 僅 `{ difficulty }` |
| repo 檔案清單 | 無資料庫、無 schema、無 migration |
| Browser reproduction | 重整後狀態正確保留（同瀏覽器）；換 context 即為全新使用者 |

### 使用者 / 產品影響

「連續達標天數」是產品的核心黏著機制，而它承載的是使用者的情感投資
（「我已經連續 100 天了」）。一次清快取就永久歸零，且**沒有任何方式可以還原**。
對長者而言，這類意外（換手機、子女幫忙清理手機）發生機率並不低，
而一次歸零很可能就是永久流失。

與 IC-002 疊加時更嚴重：資料一旦被重複計分污染，唯一的「修法」是清除全部資料。

### 技術影響

- **Architecture**：這是產品下一階段的天花板。任何「換手機還在」「家人可以看爸媽的紀錄」
  「排行榜」的想法，都必須先有帳號與資料庫。
- **Data**：無伺服器端資料代表沒有任何資料修復或稽核能力。
- 同時確認的次要問題：同一裝置開兩個分頁會互相覆寫（後寫贏），機率低但真實存在。

### 建議處理方向

需要 AIOS 先做產品決策。三個層級的可能方向：
① 接受現狀（維持零摩擦這個核心價值）；
② 加入資料匯出／匯入（低成本折衷，不破壞零摩擦）；
③ 建立帳號與後端資料庫（高成本，且與「免註冊」的核心價值衝突）。
PROJECT_AUDIT.md 建議方向 ②，但這**是產品決策，不是工程決策**。

### 是否阻塞其他工作
`NO` — 但它是產品從 MVP 進入下一階段時必然要面對的架構天花板。

### 建議優先序理由

影響真實但非立即故障，且正確方向取決於產品決策與 IC-008 的使用者數據。
方向 ② 的成本低、可先行評估。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或先降為 backlog 等待 IC-008 的結果**。
2. 產品決策：接受現狀 / 做匯出匯入 / 做帳號系統。
3. 是否要求與 IC-002 綁定考量（資料污染後的救援手段）。

---

## IC-010｜`js/app.js` 與 `js/render/*` 共 513 行零測試覆蓋

### 類型
`TECH_DEBT`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. 現有 120 個測試（78 JS + 42 Python）全部是**純函式與 mock 層級**，
   沒有任何 DOM 測試或 E2E 測試。
2. `js/app.js`（258 行，**全部的狀態轉換邏輯**）與 `js/render/*`（255 行）
   **沒有任何一行被測試執行過**。唯一例外是 `render/helpers.js` 的 `escapeHtml`（4 個測試）。
3. **IC-002 就是落在這個缺口裡**：該缺陷存在時，`npm test` 的 78 個測試**全數通過**。
4. `tests/integration/game-flow.test.mjs` 雖名為整合測試，實際只組合純函式
   （`applyDailyResult` / `revertDailyResult`），**不涵蓋 `js/app.js` 的事件處理路徑**——
   也就是 IC-002 的所在位置。
5. 本次 Audit 使用的 Playwright 驗證腳本**未進入 repository**（僅存於 session scratchpad）。

### 證據

| 來源 | 內容 |
|---|---|
| `package.json:6` | `node --test --test-concurrency=1 tests/*.test.mjs tests/integration/*.test.mjs` |
| `tests/` 全部 6 個檔案 | 無 jsdom、無 playwright、無 DOM 操作；`api`／`logic`／`ai`／`helpers` 為被測對象 |
| Test result | IC-002 缺陷存在的情況下，`# tests 78 / # pass 78 / # fail 0` |
| `tests/integration/game-flow.test.mjs:5-11` | import 來源僅 `js/logic.js`，未觸及 `js/app.js` |
| Browser reproduction（本次 Audit） | 以外部 Playwright 腳本才抓到 IC-002 |

### 使用者 / 產品影響

任何人修改核心流程（步數輸入、答題、完成、返回、重試）時，
**CI 全綠並不代表沒壞掉**。IC-002 是已發生的實例。
對使用者的間接影響是：這類缺陷會持續進入 production 而不被攔截。

### 技術影響

- **Maintainability**：513 行無保護的程式碼，正好是使用者互動最密集、狀態轉換最複雜的部分。
- **Reliability**：現有測試的「全綠」訊號會給予錯誤的安全感。
- 注意：PROJECT_AUDIT.md 明確**不建議**全面補測試覆蓋率——
  重點是覆蓋「最值得保護的核心 flow」，不是追求數字。

### 建議處理方向

只針對三個狀態轉換與返回／重試路徑建立 DOM 層級的回歸測試，
不追求全面覆蓋率、不引入大型測試框架（需符合專案的零依賴原則——
本次 Audit 已驗證環境內建可用的瀏覽器自動化能力）。
可考慮與 IC-002 的修復綁定交付。

### 是否阻塞其他工作
`NO`

### 建議優先序理由

它本身不是缺陷，而是「缺陷無法被攔截」的結構性原因，已有一個實證案例（IC-002）。
但範圍必須節制，否則容易變成低價值的覆蓋率競賽。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或要求併入 IC-002 作為該修復的附帶交付**。
2. 若獨立開立：範圍限定在哪些 flow（建議：返回／重試／完成三條路徑）。
3. 是否接受引入測試用依賴——這會與專案現行的**零 npm 依賴**原則衝突，需要明確裁示。

---

## IC-011｜前端 `logError` 無任何收集端，錯誤寫了等於沒人看得到

### 類型
`OBSERVABILITY`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `js/logger.js` 的 `logError` 只呼叫 `console.error`，輸出到**使用者自己的瀏覽器 console**。
2. 呼叫點涵蓋 `js/ai.js`（3 處）、`js/storage.js`（3 處）、`js/app.js`（2 處）——
   錯誤路徑的埋點本身是完整的。
3. **沒有任何收集端**：無 Sentry、無 error reporting、無 GA4 exception 事件、無自訂上報。
4. 產品刻意不對使用者顯示任何錯誤（AI 失敗、題庫載入失敗皆靜默降級），
   因此使用者也不會主動回報。
5. 對照：後端 `api/questions.js` 的結構化 log 會進入 Vercel stdout，**至少是可查的**。

### 證據

| 來源 | 內容 |
|---|---|
| `js/logger.js:1-10` | `console.error(JSON.stringify({ level, ts, ctx, msg }))` — 終點就是 console |
| `js/ai.js:30, 36, 43` / `js/storage.js:9, 18, 27` / `js/app.js:52, 58` | 呼叫點完整 |
| `js/analytics.js:17-22` | `trackEvent` 存在，**但沒有任何一處用它上報錯誤** |
| `CLAUDE.md` §2 | 要求「不寫 log 等於讓排查問題的人在黑暗中操作」「不用讀程式碼也能從 log 診斷問題」 |

### 使用者 / 產品影響

若 AI proxy 掛掉、`questions.json` 載入失敗、或 localStorage 被瀏覽器封鎖，
**使用者會靜默降級，而營運端完全不會知道**。
產品的韌性設計（三層降級）在這裡變成雙面刃：它讓使用者不受影響，
但也讓「已經有東西壞了」這件事永遠不會浮現。

### 技術影響

- **Reliability**：前端沒有任何 runtime 可觀測性。
- **Maintainability**：`CLAUDE.md` §2 的目標在前端只達成了一半——log 格式對了，但沒有接收端。
- 與 IC-005 的關係：IC-005 是 CI／排程層的可觀測性，本項是前端 runtime 層，
  兩者的 implementation 與 verification 完全不同，故拆開。

### 建議處理方向

利用**已存在的** GA4 通道上報關鍵錯誤事件（AI 取題失敗、題庫載入失敗、
localStorage 不可用），避免為此引入新的第三方依賴。
此方向與 IC-008 的結果相關——若 GA 未啟用，則需先解決該前提。

### 是否阻塞其他工作
`NO`

### 建議優先序理由

成本低（可沿用既有 GA4 通道），但它的價值取決於 GA 是否已啟用（IC-008）。
在無使用者的情況下價值有限。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或先降為 backlog 等待 IC-008**。
2. 是否接受「沿用 GA4 上報錯誤」這個方向，或要求導入專門的 error tracking
   （後者會引入新的第三方依賴，與專案零依賴原則衝突）。

---

## IC-012｜開發文件與實作脫節，已完成項目仍列為待辦、未實作章節寫得像已存在

### 類型
`TECH_DEBT`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

Audit 逐項比對後確認 **9 處**文件與實作不一致：

| # | 文件說 | 實際是 |
|---|---|---|
| 1 | `CLAUDE.md` §2：`api/questions.js:143` 為非結構化 log，需改 | **已改好**，且行號已失效 |
| 2 | `CLAUDE.md` §2：`api/questions.js:151-158` 的 JSON parse catch 靜默失敗 | **已補上 `logParseError`** |
| 3 | `CLAUDE.md` §2：`js/ai.js:35` 為 silent swallow | **已補上 `logError`** |
| 4 | `CLAUDE.md` §5：待處理「拆解 app.js 的 render 函式」 | **已完成**（`js/render/` 五個模組） |
| 5 | `CLAUDE.md` §5：待處理「補結構化 log 至所有 silent catch」 | **已完成** |
| 6 | `CLAUDE.md` §5：待處理「評估 `isValidQuestions` 共用策略」 | **已完成**（`api/questions.js:14` 已 import 前端版本） |
| 7 | `CLAUDE.md` §6：異常偵測閾值、自動開 issue、hot-fix 協議 | **整章零實作**（見 IC-005） |
| 8 | `README.md`：「共 40 個測試」／「20 個測試」 | 實際 **78 / 42** |
| 9 | `js/logic.js:17` 註解：「與 `index.html` `#si` 的 max 屬性對齊」 | `#si` 已搬至 `js/render/step.js`，`index.html` 內無此元素 |

另：`CLAUDE.md` §4 要求 `test.yml` 有獨立的 `integration-tests` job，實際不存在
（由 `npm test` 的 glob 涵蓋，執行結果等價）。

### 證據

| 來源 | 內容 |
|---|---|
| `CLAUDE.md` §2「目前待改善」段 | 對照 `api/questions.js:162-219`（已結構化）、`js/ai.js:42-47`（已 logError） |
| `CLAUDE.md` §5「已知待處理項目」段 | 對照 `js/render/` 五個檔案、`api/questions.js:14` |
| `CLAUDE.md` §6 全章 | `grep` 全 repo 無對應 workflow、無 named constant |
| Test result | `npm test` → 78；`python3 -m unittest` → 42 |
| `README.md`「執行測試」段 | 仍寫 `node --test tests/*.test.mjs（共 40 個測試）` |

### 使用者 / 產品影響

無直接使用者影響。但對**接手者**有實際成本：
Audit 過程中即出現此問題——照 `CLAUDE.md` §2／§5 工作的人會去修**已經修好的東西**，
同時誤以為 §6 的維運機制**已經存在**（實際上一行都沒有）。
考慮到這個 repo 大量依賴 AI agent 協作（`CLAUDE.md`／`AGENTS.md`／`ai-pr-review.yml`），
文件失準會被放大：每一個新 session 都會從錯誤的前提開始。

### 技術影響

- **Maintainability**：`CLAUDE.md` 目前無法當作待辦清單使用，失去了它被建立的主要功能。
- 與 IC-005 的關係：若 AIOS 決定不完整實作 §6，則 §6 的定位調整應在此處一併處理。

### 建議處理方向

校正三份文件與實作的落差：把已完成項目從待辦清單移除、更新過期的行號與測試數字、
並將 `CLAUDE.md` §6 的定位明確化（是「未實作的目標」還是「現行標準」）。
不需要重寫文件結構。

### 是否阻塞其他工作
`NO` — 但它會持續對每一個接手的人或 agent 產生誤導成本。

### 建議優先序理由

成本極低、影響範圍是所有後續工作的起點品質。
考慮到本專案高度依賴 AI agent 協作，文件失準的代價比一般專案高。

### AIOS 需要決定

1. **是否核准正式開立 Issue**。
2. 是否要求與 IC-005 綁定（§6 的定位取決於是否決定實作它）。
3. 是否要求把 `PROJECT_AUDIT.md` 的發現回寫進 `CLAUDE.md`／`README.md`，
   或維持兩份文件分離。

---

## IC-013｜後端部署設定不在 repo 內（無 `vercel.json`），無法 review 或重建

### 類型
`TECH_DEBT`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. repo 內**不存在 `vercel.json`**。
2. `api/questions.js` 的 runtime、region、function 設定、環境變數值，
   **完全只存在於 Vercel 控制台**。
3. `api/questions.js:14` 從 `../js/logic.js` import——這是一個跨目錄的相依，
   其打包行為依賴 Vercel 的預設 tracing，**repo 內沒有任何設定可以保證或驗證這件事**。
4. 環境變數散落在**三個外部系統**：Vercel env、GitHub Secrets、GitHub Variables，
   repo 內無單一清單（僅 `README.md` 與 `api/questions.js` 開頭註解各有部分描述）。
5. `GEMINI_API_KEY` **同時存在 Vercel env 與 GitHub Secrets 兩份**。

### 證據

| 來源 | 內容 |
|---|---|
| repo 檔案清單 | 無 `vercel.json` |
| `api/questions.js:12-16` | `import { isValidQuestions } from '../js/logic.js';` — 跨目錄相依 |
| `api/questions.js:6-10` | 以註解形式記錄 4 個環境變數，非可執行的設定 |
| `README.md`「AI proxy 設定」段 | 以表格描述環境變數，屬人工維護的文件 |
| `.github/workflows/update_questions.yml:29` + Vercel 設定 | `GEMINI_API_KEY` 兩處各存一份 |

### 使用者 / 產品影響

無直接使用者影響（目前）。潛在影響是：若 Vercel 專案被誤刪或誤設，
**repo 內沒有任何資訊可以重建它**，AI 出題功能會無法恢復。
此外 `GEMINI_API_KEY` 存於兩處，輪替時容易漏掉一邊，導致其中一條 Gemini 路徑靜默失效。

### 技術影響

- **Deployment**：後端部署是黑箱，無法 code review、無法版本控管、無法從 repo 重建。
- **Architecture**：這是整份 Audit 中唯一「真相分裂在 repo 之外」的一層
  （見 PROJECT_AUDIT.md 的 Source of Truth 章節）。
- **Maintainability**：換人接手就是完全的黑箱。

### 建議處理方向

把後端部署設定納入 repo（建立 `vercel.json`），並在 repo 內建立單一的環境變數清單文件，
標明每個變數的存放位置、必填性與用途。**不需要變更任何 runtime 行為。**

### 是否阻塞其他工作
`NO`（但與 IC-007 相關：IC-007 的驗證會順帶揭露 Vercel 目前的實際狀態）

### 建議優先序理由

成本低、風險低，且能消除唯一的部署黑箱。
但在 IC-007 確認 AI 路徑是否啟用之前，投入的價值不明。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或先等待 IC-007 的驗證結果**。
2. 範圍是否包含環境變數清單文件（或該部分併入 IC-012 的文件校正）。

---

## IC-014｜核心流程使用原生 `alert()`／`confirm()`，對銀髮族目標客群不友善

### 類型
`UX`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. 步數輸入錯誤時使用原生 `alert('請輸入有效步數')`（`js/app.js:146`）。
2. 重新挑戰時使用原生 `confirm('重新挑戰？今日得分將扣除。')`（`js/app.js:234`）。
3. 複製失敗時使用原生 `prompt('長按複製：', txt)`（`js/render/complete.js:60, 62`）。
4. 原生對話框**不受本產品的字體縮放設定影響**——使用者把字體調到 130%，
   對話框仍是系統預設大小。
5. 產品的明確目標客群是銀髮族，且已為此投入大量無障礙工作
   （rem 縮放、ARIA、`:focus-visible`、48px 觸控目標、`prefers-reduced-motion`）。
6. **頁面內已有現成的替代位置**：`#db` 元素已具備 `aria-live="polite"`
   （`js/render/step.js:15`），可直接承載 inline 錯誤訊息。
7. 已實測確認三個對話框皆能正確觸發（非壞掉，是體驗問題）。

### 證據

| 來源 | 內容 |
|---|---|
| `js/app.js:144-148` | `if (isNaN(v) \|\| v < 0 \|\| v > MAX_STEPS) { alert('請輸入有效步數'); return; }` |
| `js/app.js:234` | `if (!confirm('重新挑戰？今日得分將扣除。')) return;` |
| `js/render/step.js:15` | `<div id="db" class="diff-badge" ... aria-live="polite"></div>` — 現成的無障礙容器 |
| `css/styles.css:29-38, 21, 140-142` | 字體縮放、focus-visible、reduced-motion 的實作（證明 a11y 是本專案的明確投入方向） |
| Browser reproduction | `PASS [edge]: 空白步數按開始 → alert="請輸入有效步數"` / 超過上限同樣觸發 |

### 使用者 / 產品影響

對**本產品明確鎖定的目標客群**而言，這是實質的體驗缺口：
- 把字體調到「特大」的長輩，看到的錯誤訊息仍是系統小字。
- 原生對話框會奪走焦點、不受樣式控制、對讀屏軟體的行為與頁面內的 `aria-live` 不同。
- 它出現在**核心流程的入口**（步數輸入）與**破壞性操作**（重新挑戰）上，不是邊緣路徑。

這是一個「產品其他部分都很認真做無障礙、唯獨這三處沒有」的一致性缺口。

### 技術影響

`無重大技術影響` — 改動侷限於三處 UI 呈現方式，不涉及狀態、資料或架構。
（注意：破壞性操作仍需要確認機制，`confirm` 的替代方案不能只是移除。）

### 建議處理方向

把步數輸入的錯誤訊息改為頁面內的 inline 提示（可直接使用既有的 `#db` `aria-live` 容器），
使其受字體縮放與樣式控制。重新挑戰的確認則需要頁面內的確認 UI 取代 `confirm`，
範圍較大，可考慮分開評估。

### 是否阻塞其他工作
`NO`

### 建議優先序理由

影響的是產品最在意的客群與最一致的設計投入，但不是故障，
且急迫性取決於是否有真實使用者（IC-008）。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或先降為 backlog 等待 IC-008**。
2. 範圍：是否只處理 `alert`（成本低、風險低），或一併處理 `confirm`
   （需要新的頁面內確認 UI，範圍明顯放大）。
3. 是否一併納入 Audit 中的兩個相關無障礙缺口（`<main>` 缺 `aria-live`、無 skip link），
   或維持獨立。

---

## IC-015｜Gemini 配額的唯一防線為單實例記憶體限流

### 類型
`RELIABILITY`

### 嚴重度
`P2`

### 狀態
`CANDIDATE — AIOS REVIEW REQUIRED`

### 已確認事實

1. `api/questions.js` 的限流狀態存於模組級 `Map`（`api/questions.js:34` 的 `_hits`），
   **Vercel serverless 為多實例且會冷啟動**，因此限流僅在單一熱實例內有效。
2. **程式碼本身已誠實記錄此限制**（`api/questions.js:31-33` 的註解），
   並指出「若需嚴格的全域限流，應改接 Vercel KV / Upstash Redis」。
3. `CLAUDE.md` §6 已將 `RATE_LIMIT_MAX` 標記為 scaling lever，
   並規定「不得在無分析的情況下調整」。
4. 限流**已正確地排在呼叫 Gemini 之前**，且有 32 個 proxy 測試涵蓋限流行為
   （含「429 不應觸發 fetch」的驗證）。
5. origin allowlist 是主要防線，但 `origin` header 對非瀏覽器的請求可偽造。
6. **目前流量狀態未知**（見 IC-008），因此實際風險無法量化。

### 證據

| 來源 | 內容 |
|---|---|
| `api/questions.js:29-34` | 註解明載「此限流為『盡力而為』的單實例防護……無法跨實例共享狀態」 |
| `api/questions.js:60-70` | `checkRateLimit` 純函式實作，邏輯正確 |
| `api/questions.js:256-274` | 限流在 `callGemini` 之前執行，且設定 `X-RateLimit-*` / `Retry-After` |
| `tests/proxy.test.mjs` | 32 個測試，含「限流在呼叫 Gemini 前生效（429 不應觸發 fetch）」 |
| `CLAUDE.md` §6 | `RATE_LIMIT_MAX`／`MAX_TRACKED_KEYS` 列為 auto-scaling 上限 |

### 使用者 / 產品影響

若遭到分散式的配額洗版，Gemini 配額耗盡後 AI 出題會回 502，
前端會**靜默降級到題庫**——使用者不會看到錯誤，但 AI 差異化功能會實質失效，
且依 IC-011（前端無錯誤收集）與 IC-005（無告警），**營運端不會知道**。

目前流量下機率低。

### 技術影響

- **Reliability**：這是 Gemini 配額的唯一數量防線，且只在熱實例上有效。
- **Architecture**：升級到跨實例限流需要引入外部儲存（KV／Redis），
  會為目前零依賴的後端增加一個基礎設施相依。

### 建議處理方向

PROJECT_AUDIT.md 的立場是：**只在有真實流量後才做**，不要提前優化。
在此之前，可考慮的低成本替代是確認 Gemini 端的配額告警是否已設定。

### 是否阻塞其他工作
`NO`

### 建議優先序理由

已確認的架構限制，但實際風險完全取決於流量，而流量目前未知（IC-008）。
提前投入會引入不必要的基礎設施相依。

### AIOS 需要決定

1. **是否核准正式開立 Issue，或直接記為 backlog 並標註「待流量達到門檻再處理」**。
2. 是否要求先定義一個明確的觸發門檻（例如 DAU 或 proxy 請求數），
   避免這一項在 backlog 中永久漂浮。
3. 是否先確認 Google Cloud 端的配額告警——成本遠低於改寫限流。

---

# Group D｜不建議建立 Issue

> 以下項目在 `PROJECT_AUDIT.md` 中有記錄，但經整理後認為**不值得單獨追蹤**。
> **保留理由是為了避免日後重複發現、重複討論。**
> AIOS 若不同意任何一項的判斷，可要求提升為正式 Candidate。

| Audit 項次 | 項目 | 不建議單獨開立的理由 |
|---|---|---|
| P2-1 | 完全沒有 linter／formatter | 屬工具偏好，**無任何實際影響證據**——現行程式風格一致。引入工具鏈會與零依賴原則衝突。若 IC-010 決定引入測試依賴，可在該 Issue 內一併評估。 |
| P2-3 | localStorage 單調成長，無過期清理 | 每天新增約 3 個 key 且永不刪除，但**距離 5MB 上限極遠**，無任何實際影響證據。屬理論問題。 |
| P2-7 | 無 staging／preview 環境 | merge 即上線確實是風險，但**在 IC-001 的交付鏈修好之前討論此事沒有意義**。建議在 IC-001 處理時一併評估是否需要，不另立。 |
| P2-8 | 兩套 Gemini 整合（Python SDK vs Node fetch）已開始漂移 | **目前兩邊規則實際等價，無漂移造成的實際問題**。IC-003 的 SDK 遷移執行時會自然碰到這個決策點，屆時再議較有效率。 |
| P2-10 | `ai-pr-review.yml` 的 diff 硬截斷 150 行 | 屬**內部開發工具**的品質問題，不影響產品或使用者。若 AIOS 高度依賴此 review 機制的品質，可要求提升。 |
| P2-12 | 「累積天數」名不副實（`log.length` 非相異天數） | **這是 IC-002 的症狀，不是獨立問題**。IC-002 採方向 B（同日冪等）即自動修正；採方向 A 則需在該 Issue 內一併處理。已在 IC-002 中記錄。 |
| P3-1 | `assets/og-image.svg` 為 dead asset | 單一無引用檔案，零影響。可在任何相關 PR 中順手清理。 |
| P3-2 | Google Fonts 用 CSS `@import` | 對首屏有理論影響，但**無實測數據佐證對目標客群的實際衝擊**。屬效能優化，非確認問題。 |
| P3-3 | `js/logic.js:17` 註解已過期 | **已納入 IC-012 的 9 項清單中**，不另立。 |
| P3-4 | 無 skip link；`<main>` 無 `aria-live` | 已在 IC-014 的「AIOS 需要決定」中列為可選範圍，不另立。 |
| P3-5 | `test.yml` 缺獨立的 `integration-tests` job | `npm test` 的 glob **已涵蓋，執行結果等價**。純粹是與 `CLAUDE.md` §4 文字不符，已納入 IC-012 的文件校正範圍。 |
| P3-6 | 同一裝置開兩個分頁會互相覆寫 | 機率低，**無任何使用者回報證據**，且在單裝置單使用者的實際使用情境下幾乎不會發生。已在 IC-009 中附帶記錄。 |
| P3-7 | 一次性腳本（`seed_questions.py`／`rebalance_questions.py`，共 864 行）留在 root 未標示為歸檔 | **不是 dead code**（`seed_questions` 被 `rebalance_questions` import，且有 5 個測試守著，是 1200 題的可重現來源）。整理僅為觀感。 |

---

# Dependency Map

```
┌─ 交付鏈（必須先修，否則下游成果送不到使用者）─────────────────┐
│                                                              │
│   IC-001（修復交付鏈斷點）                                     │
│        ↓                                                     │
│   IC-004（生成韌性：停止整批全滅）                              │
│        ↓                                                     │
│   IC-006（題庫難度校準）                                       │
│                                                              │
│   IC-005（失敗告警）── 可平行，但在 IC-001 之後價值最高          │
└──────────────────────────────────────────────────────────────┘

┌─ 驗證先行（結果會改變下游的優先序判定）──────────────────────┐
│                                                              │
│   IC-007（確認 AI 路徑是否啟用）                               │
│        ↓                                                     │
│   IC-015（限流升級）、IC-013（vercel.json）                    │
│                                                              │
│   IC-008（確認 GA4 與真實使用數據）                            │
│        ↓                                                     │
│   IC-006（內容品質）、IC-009（資料可攜）、                      │
│   IC-014（UX 友善度）、IC-011（前端錯誤收集）                   │
└──────────────────────────────────────────────────────────────┘

┌─ 獨立路徑（不受上述阻塞）──────────────────────────────────┐
│   IC-002（重複計分修復）── 與 IC-010（回歸測試）建議綁定交付     │
│   IC-003（SDK 遷移）                                          │
│   IC-012（文件校正）── 與 IC-005 的 §6 定位決策相關             │
└──────────────────────────────────────────────────────────────┘
```

### 依賴說明

**IC-001 → IC-004 → IC-006**
`IC-001` 未完成前，題庫的任何改善（無論是提高生成成功率或改善難度校準）
**都不會出現在使用者端**。這代表：即使做完，也無法驗證成效、無法收到回饋、無法判斷是否有效。
在斷點修復前投入這兩項，等於在一條不通的管線上游做優化。

**IC-004 → IC-006**
`IC-004` 未完成時，每 4 次週更新約有 1 次完全沒有新題進入。
在這個基礎上調整難度校準策略，會因為樣本流入不穩定而難以判斷改動是否有效。

**IC-001 → IC-005（建議順序而非硬依賴）**
`IC-005` 可獨立進行，但它的價值在 `IC-001` 修好之後最大——
屆時新修好的交付鏈才有「被監看」的必要。反過來說，若只做 `IC-005` 而不修 `IC-001`，
得到的會是「持續通知你部署沒有發生」。

**IC-007 → IC-015 / IC-013**
若 `IC-007` 的結果是「AI 路徑未啟用」，則 `api/` 整層在 production 是 dead code，
`IC-015`（限流升級）與 `IC-013`（`vercel.json`）的投入價值趨近於零。
**在未知狀態下投入這兩項有相當機率是白做。**

**IC-008 → IC-006 / IC-009 / IC-014 / IC-011**
這四項的**嚴重度判定**取決於「是否有真實使用者」。
若目前使用者數為 0，它們的優先序應顯著下調——
修內容品質、資料可攜與 UX 友善度，在沒有使用者的情況下不會讓任何人受益。

**IC-002 → 無阻塞**
`IC-002` 走一般 push 路徑，人類 merge 會正常觸發部署，
**不受 IC-001 的交付斷點影響**，可立即獨立進行。
但建議與 `IC-010` 綁定交付（修復同時附上回歸測試），
因為這正是現有 120 個測試結構上抓不到的缺陷類型。

**IC-003 → 無阻塞**
SDK 遷移不依賴其他項目。但若與 `IC-004` 合併為單一「生成管線韌性」Issue，
則繼承 `IC-004` 的下游關係。

---

# Recommendation

> 以下為**建議**，不是決策。正式開立與否由 AIOS 裁示。

| 建議 | 對象 | 理由 |
|---|---|---|
| 建議 AIOS 核准開立，並列最高優先 | **IC-001** | 唯一一個「招牌功能對使用者已實質失效且已持續 61 天」的項目；改動僅限 workflow YAML，不觸碰產品程式碼，驗證方式客觀；且是 IC-004／IC-006 的前置條件。 |
| 建議 AIOS 核准開立，與 IC-001 平行進行 | **IC-002** | 已在瀏覽器完整重現；影響使用者直接看到的核心數字；資料損壞**無法從伺服器端修復**；修法有同檔案的正確範本可循；不受 IC-001 阻塞。 |
| 建議 AIOS **優先執行驗證**，且可與 IC-001 平行 | **IC-007、IC-008** | 兩者成本極低（可合併為一次查詢動作），但結果會改變 6 個其他 Candidate 的優先序判定。在未取得答案前排定 roadmap，有相當機率把資源投在錯的方向。 |
| 建議 AIOS 考慮合併為單一 Issue | **IC-003 + IC-004** | 兩者 root cause／implementation／verification 不同，故本文件先行拆開；但兩者都改動 `generate_questions.py` 與同一個 workflow，合併交付可能更有效率。**此判斷需要 AIOS 裁示。** |
| 建議 AIOS 考慮綁定交付 | **IC-002 + IC-010** | IC-010 的最小可行範圍正好就是 IC-002 需要的回歸測試。但 IC-010 可能需要引入測試依賴，與零依賴原則衝突——**需要明確裁示**。 |
| 建議 AIOS 先降為 backlog，等待 IC-008 結果 | **IC-009、IC-011、IC-014** | 三者的嚴重度都取決於是否有真實使用者。 |
| 建議 AIOS 先降為 backlog，等待 IC-007 結果 | **IC-013、IC-015** | 兩者的投入價值都取決於 AI 路徑是否實際啟用。 |
| 建議 AIOS 核准開立（低成本、高槓桿） | **IC-012** | 成本極低，但影響所有後續工作（含 AI agent session）的起點品質。 |
| 建議 AIOS 決定範圍後核准 | **IC-005** | 最小迴路（失敗通知）成本低且 repo 內有現成範本；完整實作 `CLAUDE.md` §6 則範圍大得多。 |
| 建議 AIOS 先回答產品問題再決定範圍 | **IC-006** | 「題庫要全 AI 化還是保留人工基準」是產品決策，答案直接決定 Issue 的方向與範圍。 |

---

*本文件由 `PROJECT_AUDIT.md` 萃取，所有「已確認事實」均可追溯至該報告或其引用的原始證據。*
*本輪未修改任何產品程式碼、未建立任何 GitHub Issue、未建立 PR 或修復分支。*
*等待 AIOS 對本文件做下一階段決策。*
