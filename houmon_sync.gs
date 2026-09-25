// ============================================================
// 訪問歯科 カレンダー → スプレッドシート 自動転記スクリプト
// バージョン: 10.2.0（要件定義書 v0.2 フェーズ1対応）
// 実行アカウント: wadadc.houmon@gmail.com
// 更新日: 2026-09-25
// ============================================================
// 【v10.2.0 の変更点】（本日分の試行結果を受けた修正）
//   1. E列(治療内容)を「ケア」「義歯」等の短い単語で表示（単語をクリックで記録ドキュメントが開く）
//      CONTENT_MODE='label'。単語の辞書は CONTENT_LABEL_RULES で調整する
//      書き込んだ行は折り返さず（はみ出しは切り詰め）、行の高さを強制的に揃える
//   2. 「PCM」等の患者ではない予定を転記しない
//      ・NON_PATIENT_KEYWORDS に PCM を追加し、大文字/小文字・全角/半角を区別せず判定
//      ・患者を特定できず、日本語(漢字/かな)も3桁以上の番号も含まない予定は患者ではないとみなす
//   3. A列右上の黒い印（自動生成行の目印メモ）を廃止し、見えない「行メタデータ」に変更
//      既存タブに残っている目印メモは、実行時に自動でメタデータへ置き換える
//      （全日付タブを一括で消す場合はメニュー「目印メモの一括削除」）
// ============================================================
// 【v10.0.0 の変更点】
//   1. 施設フォルダを18件追加（鳴門病院・兼松病院ほか）＝ 計22ルート
//   2. ROOT_FOLDER_IDS に「施設名の明示指定」形式を追加（文字列指定は従来通り動作）
//   3. 東病院の3階層構造（施設 → 病棟 → 患者）に対応（再帰走査 scanFacilityTree）
//      → B列の施設名は「東病院」になり、病棟名は rec.ward に保持（表示はオプション）
//   4. F4強化: カルテ番号の重複・同姓同名を「要確認」として検出（施設名ヒントで絞込）
//   5. キャッシュを分割保存に変更（CacheService 100KB上限で保存スキップされる問題の解消）
//   6. 行高さ／列幅の一括正規化関数を追加（6分制限対策の再開可能方式）
//   7. 患者マスタの事前構築メニューを追加（日次実行を軽くするため）
// ------------------------------------------------------------
// 【フォルダ構造】
//   パターンA 親フォルダ → 【施設名】 → 番号+患者名 → カルテ(Googleドキュメント)
//   パターンB 施設フォルダ → 番号+患者名 → カルテ
//   パターンC 施設フォルダ → 病棟フォルダ → 番号+患者名 → カルテ  ★東病院（v10で対応）
//
// 【フェーズ1(要件定義書 v0.2)対応内容】
//   F1  カレンダー予定取得（当日/翌日・終日予定は除外）
//   F2  タイトルのパース（読点区切り・時刻/番号混在に対応）
//   F3  氏名⇄カルテ番号 対応表の作成（分割キャッシュ）
//   F3.5 治療内容ドキュメントのURLを =HYPERLINK で挿入（中身抽出はフェーズ2）
//   F4  名寄せ（患者マスタ逆引き・正規化突合・重複時は要確認）
//   F5  スプレッドシート出力（時系列・上書き/追記+重複排除）
//   F6a カスタムメニューからの手動実行＋完了通知
//   F7  アクセスログ（メタ情報のみ・氏名等は記録しない）
//   7.1 API一時エラー時の最大3回リトライ
// ============================================================

// ============================================================
// ▼ 定数定義
// ============================================================
const SPREADSHEET_ID = '1csP0kizK-JWU_j-ZeIl7EJ9_zvEthNtzZ0x4uxE8ODE';

// ------------------------------------------------------------
// ROOTフォルダの指定（2つの書き方を混在できる）
//
//  ① 文字列指定  '1AbC...'
//     → 従来通り自動判別。直下の子が「番号+氏名」なら ROOT 自体を施設とみなし、
//       そうでなければ子を施設フォルダとみなしてその配下の患者を走査する。
//       ※ 3階層（施設→病棟→患者）には対応できない。
//
//  ② オブジェクト指定  { id: '1AbC...', name: '鳴門病院' }
//     → 施設名を name に固定し、配下を MAX_SCAN_DEPTH 階層まで再帰的に走査する。
//       病棟フォルダなどの中間フォルダがあっても患者を拾え、B列は name になる。
//       ドライブ側のフォルダ名（例:「とくしま医療センター東病院」）と
//       カレンダー／予定表の呼び名（例:「東病院」）が違う場合もこれで揃う。
//
//  施設を増やすときは、この配列に1行追記するだけ。
// ------------------------------------------------------------
const ROOT_FOLDER_IDS = [
  // ---- 既存（v9.0.0から変更なし・自動判別） ----
  '1Ob3Q_nFxMfS3Wisu6DtvuClqgypy5OFX', // 【藍寿苑】
  '1bjIMcIgUokW7sIL37s5QfQpioe9fTNPB',
  '1Um3bDzN9Jt6BgKHD_rcFL6BrqBpgXiBk',
  '1u0uHqlZ-uJe9-cKBfKgOdq3zEjRmg5gr',

  // ---- 追加18件（2026-09-17 登録） ----
  { id: '1AaYEhNE3hVHaVgSrgnJ1b9RZUhHeRXkk', name: '鳴門病院' },
  { id: '1JDVrUVCTW5Ps0sg27xOm78kSbBUbZ8V-', name: '兼松病院' },
  { id: '1mFRe3N6yG3sX8mAhZwS4Bn5XJlZyHDw9', name: 'メディション凌雲' },
  { id: '1o_Po-fm_sHpTyTH_9WozYzxlUYFtSeEx', name: '昴' },
  { id: '1v3upADw243wBZ8Tld8UDZJsy42IYhyoY', name: '水光苑' },
  { id: '1053CA_pptDME0OphprKfmutWWl4XsnPo', name: 'いつもここから' },
  { id: '1ruSNudNt1y8uX4Pp8EryqyeBQV_TD5SL', name: 'グループホーム矢上' },
  { id: '19UxNKbEevmDWez3rvzfP1EDr-mVJVxYv', name: 'イツモ藍住' },
  // ★東病院: 直下が病棟フォルダ（西4病棟・西3病棟…）、その下に患者フォルダ。
  //   name指定＋再帰走査で「東病院」として登録される。
  { id: '13LxonpLaK0gu1CMKbtaQEGNLJHBef589', name: '東病院' },
  { id: '10MRQV8BZMS2TIi0NljijfXznOXTYjz_o', name: 'すみれ' },
  { id: '1QG-UoEgis-VcyhJIyLWoIYeJeymQcVW2', name: '朴樹の音' },
  { id: '1ReK-ZnDI0XucGdbHl3s2zcsRV0HSp6vM', name: '稲次病院' },
  { id: '1xzPPu5hEhcCAA-n8a5NLgGq9sntW_F_c', name: 'フレンズ' },
  { id: '18NoDbu7Vkhlqhpj7P_rDSF9CHfvgEJx9', name: 'グループホーム親の家' },
  { id: '1akdVCV-srR9isyELl25OBQeFNJmsrkOM', name: '小川病院' },
  { id: '1_SNq8UVeJ7bb5i9wqmFqAgUdwVxofHrT', name: 'リニエハイム藍住' },
  { id: '1I88yWKZL8GIzy1j7_xN0tsJmEu3m0aY3', name: '第3ガーデンハウス' },
  { id: '1lnKS9iq3DoQJ26KLIXb9UU2ELz0tdhbl', name: 'マザーHope2,3' },
];

// 施設フォルダ配下を何階層まで探すか（東病院の病棟フォルダ＝2階層目）
const MAX_SCAN_DEPTH = 3;
// B列に病棟名まで出す場合は true（例:「東病院 西4病棟」）
const WARD_IN_FACILITY = false;

const PAIR_CALENDARS = [
  { id: 'bin6k5jtja113pgodt0pnmk9kk@group.calendar.google.com', dr: '斎藤DR',  dh: 'DH寒川'  },
  { id: 'h7a37hsovvm4ip2th4cj25i2i4@group.calendar.google.com', dr: '木下DR',  dh: 'DH坂野'  },
  { id: '913ukt1ij87kiht6u0gb5lui7k@group.calendar.google.com', dr: '齋藤DR',  dh: 'DA藤枝'  },
  { id: 'htkbc93va1se4brbvr0dqv811c@group.calendar.google.com', dr: '齋藤DR',  dh: 'DH坂野'  },
  { id: '502ad1d0ec164d8dfcc8e0b49154f7fc111dc1cb7bdadf9f8e97825f54f02516@group.calendar.google.com', dr: '齋藤DR', dh: 'DH栩平' },
  { id: '407f73a30a242985b9cb5c458886476ac305c64de2afcd4c54c0ed7f4bfbd237@group.calendar.google.com', dr: '齋藤DR', dh: 'DH篠原' },
  // ↓ 新しいペアが増えたらここに追加
];

// 在宅とみなす施設フォルダ名のキーワード
const HOME_KEYWORDS = ['在宅', '居宅'];

const NON_PATIENT_KEYWORDS = [
  '会議', 'ミーティング', '研修', '休み', '祝日', '休診',
  '院長', '副院長', 'mtg', 'MTG', '打ち合わせ', '勉強会',
  '学会', '出張', '健診', '検診', '移動', '準備',
  'PCM',
];
// ※判定は大文字/小文字・全角/半角を区別しない（'pcm' 'ＰＣＭ' も除外）。
//   患者ではない予定が転記されたら、ここに単語を追加する。

// 治療内容の記録ドキュメント抽出見出し（フェーズ2でtext抽出する際に使用）
const CONTENT_HEADINGS = ['前回業務内容', '業務内容', '治療内容', '処置内容'];

// ▼ 動作モード
// 'label' = 記録ドキュメントの中身から短い単語（ケア/義歯 等）を作り、その単語をリンクにする（推奨）
// 'link'  = 「前回記録を開く」の固定文字でリンク挿入
// 'text'  = 中身の文章をそのまま転記（長くなるため非推奨）
const CONTENT_MODE = 'label';
const LINK_LABEL   = '前回記録を開く';
// E列に出す単語の辞書（上から順に判定し、当てはまったものを最大 CONTENT_LABEL_MAX 個「・」でつなぐ）
//   words の英字は前後が英字でないときだけ一致（'PD' が 'PDF' に当たらない）
//   現場の言い方に合わせて自由に追加・変更してよい
const CONTENT_LABEL_RULES = [
  { label: '義歯', words: ['義歯', '入れ歯', 'デンチャー', 'リベース', '床裏装', '増歯', '人工歯', 'FD', 'PD'] },
  { label: '抜歯', words: ['抜歯', 'EXT'] },
  { label: '根治', words: ['根管', '根治', '抜髄', '感根', '根充', 'RCT'] },
  { label: '充填', words: ['充填', '充塡', 'CR'] },
  { label: '印象', words: ['印象', '型取り'] },
  { label: 'SRP',  words: ['SRP'] },
  { label: 'ケア', words: ['ケア', '口腔衛生', '清掃', 'PMTC', 'ブラッシング', 'TBI', 'スケーリング', '歯石', 'SC'] },
];
const CONTENT_LABEL_MAX      = 2;  // 1セルに出す単語の最大数（例: 義歯・ケア）
const CONTENT_FALLBACK_CHARS = 6;  // 辞書に当てはまらないとき、記録の先頭何文字を出すか
// 'overwrite'   = 前回の自動生成行を消してから入れ直す（毎回きれいに再生成・推奨）
// 'append_dedup'= 既存と重複しない行だけ追記
const WRITE_MODE   = 'overwrite';
const AUTO_META_KEY = 'houmon_auto';            // 自動生成行の目印（行メタデータのキー・画面には出ない）
const AUTO_MARKER   = '__訪問予定表_自動生成__'; // v10.0以前の目印（A列メモ）。移行・削除のためだけに使用
const USE_CACHE    = true;        // 患者マスタをキャッシュ
const MAX_RETRY    = 3;           // API一時エラー時のリトライ回数
// A〜Gのみ自動記入し、H〜T（O/P/Q含む）は手動運用とする。
// 在/衛訪/衛居宅（O/P/Q）も自動で〇を入れたい場合は true に変更。
const FILL_VISIT_TYPE = false;
// 要確認理由をT列(備考)にも書き出す場合は true（既定は実行ログにのみ出力）
const WRITE_BIKO_TO_SHEET = false;

const DATA_START_ROW    = 3;
const TOTAL_COLS        = 20;      // A〜T
const CACHE_TTL_SEC     = 6 * 60 * 60; // 患者マスタキャッシュの保持時間（6時間）
const CACHE_CHUNK_SIZE  = 90000;       // 1キーあたりの保存サイズ（CacheService上限100KB対策）
const LOG_SHEET_NAME    = '実行ログ';

// 列インデックス（0基点）
const C = {
  TIME: 0, FACILITY: 1, NO: 2, NAME: 3, CONTENT: 4, DR: 5, DH: 6,
  ZAI: 14, EIHOU: 15, EIKYOTAKU: 16, BIKO: 19,
};

// ▼ レイアウト正規化（行高さ／列幅）
const ROW_HEIGHT_DATA   = 21;      // 予定行の標準高さ(px)
const NORMALIZE_COL_WIDTH = false; // 列幅もテンプレタブに揃える場合 true（実行時間が延びます）
const COL_WIDTH_TEMPLATE  = '';    // 列幅の見本タブ名（空なら最初に見つかった日付タブ）
const LAYOUT_TIME_BUDGET_MS = 4.5 * 60 * 1000; // 1回の実行で使う時間上限（GAS制限6分）
const LAYOUT_PROP_KEY   = 'layoutNormalizeProgress';
// 日付タブ名の判定（例: R8_7月6日(月) / R8_7月6日（月））
const DAY_TAB_RE = /^R\d+_\d{1,2}月\d{1,2}日[(（].[)）]$/;


// ============================================================
// F6a カスタムメニュー（スプレッドシートを開いたとき）
//   ※このメニューを出すにはスクリプトがスプレッドシートに
//     「コンテナバインド」されている必要があります（導入手順参照）
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('訪問予定表')
    .addItem('予定表を更新（当日）', 'menuUpdateToday')
    .addItem('予定表を更新（翌日）', 'menuUpdateTomorrow')
    .addItem('予定表を更新（日付指定）', 'menuUpdatePickDate')
    .addSeparator()
    .addItem('患者マスタ診断', 'diagnosePatientFolders')
    .addItem('患者マスタ 事前構築', 'prebuildPatientMaster')
    .addItem('患者マスタ キャッシュ削除', 'clearMasterCache')
    .addSeparator()
    .addItem('レイアウト正規化（行高さ）', 'normalizeLayout')
    .addItem('レイアウト正規化 進捗リセット', 'resetLayoutProgress')
    .addItem('行高さの現状サンプル確認', 'diagnoseRowHeights')
    .addSeparator()
    .addItem('目印メモの一括削除（A列の黒い印）', 'migrateMarkerNotes')
    .addToUi();
}

function menuUpdateToday()    { runSync(new Date(), true); }
function menuUpdateTomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  runSync(d, true);
}
function menuUpdatePickDate() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('対象日を入力してください（例: 2026-07-06）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const s = res.getResponseText().trim();
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) { ui.alert('日付の形式が正しくありません（yyyy-MM-dd で入力してください）'); return; }
  runSync(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), true);
}


// ============================================================
// メイン関数：トリガー実行用エントリ（当日・ポップアップなし）
// フェーズ1.5で毎朝トリガーに登録する対象
// ============================================================
function syncVisitSchedule() {
  runSync(new Date(), false);
}

// 【テスト用】2026-07-06 を直接転記（エディタで選んで実行）
function 転記テスト_7月6日() {
  runSync(new Date(2026, 6, 6), false); // 月は0基点=6が7月
}


// ============================================================
// 本体処理
// @param targetDate 対象日（Date）
// @param showPopup  完了ポップアップを出すか（メニュー実行時true）
// ============================================================
function runSync(targetDate, showPopup) {
  const summary = { written: 0, review: 0, errors: 0, targetDate: fmtDate(targetDate) };
  Logger.log(`=== 訪問予定転記処理 開始（対象日: ${summary.targetDate}） ===`);

  const startTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
  const endTime   = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

  // Step1: カレンダーからイベント収集（F1: 終日予定除外）
  const allEvents = collectAllEvents(startTime, endTime);
  Logger.log(`患者候補イベント数: ${allEvents.length}`);
  allEvents.sort((a, b) => a.startTime - b.startTime);

  // Step2: 対象日の日付タブを選択
  let ss, sheet;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const candidates = buildDateSheetNames(targetDate);
    for (const name of candidates) {
      sheet = ss.getSheetByName(name);
      if (sheet) { Logger.log(`書き込み先シート: 「${name}」`); break; }
    }
    if (!sheet) throw new Error(`当日のシートが見つかりません。探した名前: ${candidates.map(n => `「${n}」`).join(' / ')}`);
  } catch (e) {
    Logger.log(`スプレッドシートエラー: ${e.message}`);
    finishPopup(showPopup, `エラー: ${e.message}`);
    return summary;
  }

  if (allEvents.length === 0) {
    Logger.log('対象日の訪問予定はありません。処理終了。');
    writeAccessLog(ss, summary);
    finishPopup(showPopup, `対象日(${summary.targetDate})の予定はありませんでした。`);
    return summary;
  }

  // Step3: 患者マスタ構築（F3: キャッシュ利用）
  const master = buildPatientMaster(ss);
  Logger.log(`患者マスタ登録数: ${master.list.length}（施設${master.facilities.length}件）`);
  if (master.list.length === 0) {
    Logger.log('【中断】患者マスタが空です。ROOT_FOLDER_IDS・アクセス権を確認してください。');
    summary.errors++;
    writeAccessLog(ss, summary);
    finishPopup(showPopup, '患者マスタが空です。フォルダのアクセス権を確認してください。');
    return summary;
  }

  // Step4: 書き込みモード準備
  //   overwrite    : システムが前回入れた行（マーカー付き）を消してから入れ直す
  //   append_dedup : 既存行と重複しないものだけ追記
  let existingKeys = new Set();
  if (WRITE_MODE === 'overwrite') {
    const cleared = clearAutoRows(sheet);
    if (cleared > 0) Logger.log(`前回の自動生成行を${cleared}行クリアしました`);
  } else if (WRITE_MODE === 'append_dedup') {
    existingKeys = loadExistingKeys(sheet);
  }

  // Step5: イベント→行データ
  const rows = [];
  let skipped = 0;
  for (const ev of allEvents) {
    const patients = extractPatientsFromTitle(ev.title, master);

    if (patients.length === 0) {
      const facility = detectFacility(ev.title, master);
      // 患者を特定できず、施設名・日本語（漢字/かな）・3桁以上の番号のどれも無い予定
      // （例:「PCM」）は患者の予定ではないとみなして転記しない
      if (!facility && looksNonPatient(ev.title)) {
        Logger.log(`患者ではない予定として除外: "${ev.title}"`);
        continue;
      }
      // F2/F4: 患者を特定できない → 要確認行
      const row = buildRow({
        ev, facilityName: facility, home: facility ? isHome(facility) : false,
        patientNo: '要確認', patientName: ev.title, contentCell: '',
        biko: `氏名未検出（元タイトル: ${ev.title}）`,
      });
      if (pushUnique(rows, row, existingKeys)) { summary.written++; summary.review++; } else skipped++;
      continue;
    }

    for (const p of patients) {
      // F4: 候補が絞れなかった（番号重複／同姓同名）→ 要確認行
      if (p.ambiguous) {
        Logger.log(`要確認: "${ev.title}" → ${p.reason}`);
        const row = buildRow({
          ev, facilityName: p.facilityHint || '', home: false,
          patientNo: '要確認', patientName: p.label, contentCell: '',
          biko: p.reason,
        });
        if (pushUnique(rows, row, existingKeys)) { summary.written++; summary.review++; } else skipped++;
        continue;
      }

      // F3.5: 治療内容ドキュメントのリンク（または フェーズ2: 中身抽出）
      let contentCell = '';
      let biko        = '';
      try {
        if (CONTENT_MODE === 'label' || CONTENT_MODE === 'link') {
          const doc = getLatestDoc(p.folderId);
          if (doc) {
            let label = LINK_LABEL;
            if (CONTENT_MODE === 'label') {
              label = makeContentLabel(extractBusinessContent(doc.id)) || LINK_LABEL;
            }
            contentCell = `=HYPERLINK("${doc.url}","${label.replace(/"/g, '""')}")`;
          } else {
            biko = '記録ファイル未検出';
          }
        } else { // 'text'（フェーズ2）
          const text = getLastBusinessContent(p.folderId);
          if (text === null)    { contentCell = 'カルテなし'; biko = '記録ファイル未検出'; }
          else if (text === '') { contentCell = '記載なし'; }
          else                  { contentCell = text; }
        }
      } catch (e) {
        contentCell = '';
        biko = `記録ファイル取得エラー: ${e.message}`;
        summary.errors++;
      }

      const isReview = !!biko;
      Logger.log(`処理: "${ev.title}" → [${facilityLabel(p) || '在宅'}] №${p.patientNo} ${p.patientName}${biko ? ' ('+biko+')' : ''}`);
      const row = buildRow({
        ev, facilityName: facilityLabel(p), home: p.isHome,
        patientNo: p.patientNo, patientName: p.patientName, contentCell, biko,
      });
      if (pushUnique(rows, row, existingKeys)) {
        summary.written++;
        if (isReview) summary.review++;
      } else {
        skipped++;
      }
    }
  }

  // Step6: 一括書き込み（F5）行が足りなければ「合計」フッター直前に自動挿入
  if (rows.length > 0) {
    const footer   = findFooterRow(sheet);            // 「合計」等の行（無ければ0）
    const startRow = getWriteStart(sheet, footer);    // フッター手前の最初の空き行
    Logger.log(`レイアウト: フッター行=${footer || '未検出'} / 書込開始=${startRow} / 必要行数=${rows.length}`);
    ensureRoom(sheet, startRow, rows.length, footer); // 不足分の行を確保
    const range = sheet.getRange(startRow, 1, rows.length, TOTAL_COLS);
    withRetry(() => range.setValues(rows), 'setValues');
    // 自動生成行の目印（画面に出ない行メタデータ）を付与 → 次回の上書き対象になる
    markAutoRows(sheet, startRow, rows.length);
    // 長い文字は折り返さず切り詰め、行の高さを強制的に統一（患者ごとに高さが変わらないように）
    try {
      range.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
      sheet.setRowHeightsForced(startRow, rows.length, ROW_HEIGHT_DATA);
    } catch (e) { Logger.log(`行高さ設定警告: ${e.message}`); }
    Logger.log(`書き込み: ${startRow}行目から ${rows.length}件（重複スキップ ${skipped}件）`);
  } else {
    Logger.log(`書き込み対象なし（重複スキップ ${skipped}件）`);
  }

  // Step7: F7 アクセスログ
  writeAccessLog(ss, summary);

  Logger.log(`=== 完了：転記${summary.written} / 要確認${summary.review} / エラー${summary.errors}（重複スキップ${skipped}） ===`);
  finishPopup(showPopup,
    `対象日: ${summary.targetDate}\n` +
    `転記: ${summary.written}件\n` +
    `要確認: ${summary.review}件\n` +
    `エラー: ${summary.errors}件\n` +
    `重複スキップ: ${skipped}件`);
  return summary;
}


// ============================================================
// 1件分の行データ（長さ20の配列）を作る
// ============================================================
function buildRow(o) {
  const row = new Array(TOTAL_COLS).fill('');

  row[C.TIME]     = o.ev.timeStr;
  row[C.FACILITY] = o.home ? '在宅' : o.facilityName;
  row[C.NO]       = o.patientNo;
  row[C.NAME]     = o.patientName;
  row[C.CONTENT]  = o.contentCell; // =HYPERLINK(...) / テキスト / 空
  row[C.DR]       = o.ev.dr;
  row[C.DH]       = o.ev.dh;

  if (FILL_VISIT_TYPE) { // H〜Tは手動運用のため既定OFF
    if (o.home) {
      row[C.ZAI]       = '〇'; // O: 在
      row[C.EIKYOTAKU] = '〇'; // Q: 衛居宅
    } else {
      row[C.EIHOU]     = '〇'; // P: 衛訪
    }
  }

  // T列(備考)は既定では自動記入しない（理由は実行ログに出力）
  if (WRITE_BIKO_TO_SHEET && o.biko) row[C.BIKO] = o.biko;
  return row;
}

// 施設名の表示（WARD_IN_FACILITY=true なら病棟名を付ける）
function facilityLabel(rec) {
  if (!rec) return '';
  if (WARD_IN_FACILITY && rec.ward) return `${rec.facility} ${rec.ward}`;
  return rec.facility;
}

// F5 重複排除：既存キーに無ければ追加してtrue、あればfalse
function pushUnique(rows, row, existingKeys) {
  const key = rowKey(row[C.NO], row[C.NAME], row[C.TIME]);
  if (existingKeys.has(key)) return false;
  existingKeys.add(key);
  rows.push(row);
  return true;
}

function rowKey(no, name, time) {
  return String(no == null ? '' : no).trim() + '|' + normalizeStr(name) + '|' + String(time == null ? '' : time).trim();
}

// 既存シートからキー集合を読む（A:時刻, C:番号, D:氏名）
function loadExistingKeys(sheet) {
  const set = new Set();
  const last = sheet.getLastRow();
  if (last < DATA_START_ROW) return set;
  const vals = sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 4).getValues();
  vals.forEach(r => {
    const time = r[C.TIME], no = r[C.NO], name = r[C.NAME];
    if (name || no) set.add(rowKey(no, name, time));
  });
  return set;
}

// overwrite用：システムが前回入れた行（目印付き）だけを削除する
//   手入力行（目印なし）や合計・フッターは触らない。
//   行ごと削除するため、前回挿入した行が積み重ならず、フッターは元位置に戻る。
//   目印は「行メタデータ」（画面に出ない）。v10.0以前の「A列メモ」の目印も対象にする。
function clearAutoRows(sheet) {
  const last = sheet.getLastRow();
  if (last < DATA_START_ROW) return 0;
  const target = new Set(findAutoRows(sheet));
  const n = last - DATA_START_ROW + 1;
  const notes = sheet.getRange(DATA_START_ROW, 1, n, 1).getNotes(); // 旧形式の目印（A列メモ）
  for (let i = 0; i < n; i++) {
    if (notes[i][0] === AUTO_MARKER) target.add(DATA_START_ROW + i);
  }
  const targetRows = Array.from(target).filter(r => r >= DATA_START_ROW).sort((a, b) => a - b);
  // 下から削除（行番号のズレを防ぐ／数式範囲は自動調整）。行メタデータも行と一緒に消える
  for (let i = targetRows.length - 1; i >= 0; i--) sheet.deleteRow(targetRows[i]);
  return targetRows.length;
}

// 自動生成行に目印（行メタデータ）を付ける。行の挿入・削除・並べ替えにも追従する
function markAutoRows(sheet, startRow, count) {
  for (let r = startRow; r < startRow + count; r++) {
    withRetry(() => sheet.getRange(`${r}:${r}`).addDeveloperMetadata(AUTO_META_KEY), 'addDeveloperMetadata');
  }
}

// 目印（行メタデータ）が付いた行番号の一覧
function findAutoRows(sheet) {
  return sheet.createDeveloperMetadataFinder()
    .withKey(AUTO_META_KEY)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.ROW)
    .find()
    .map(md => md.getLocation().getRow().getRow());
}

// 【移行用・メニュー】全日付タブのA列に残っている旧形式の目印メモ（黒い印）を消し、
//   行メタデータの目印に置き換える（その日を再実行しても上書き対象として認識される）
//   タブが多い場合は6分制限に備えて時間で区切る。未完なら再実行すると続きから処理する
function migrateMarkerNotes() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets().filter(sh => DAY_TAB_RE.test(sh.getName()));
  let tabs = 0, rowsFixed = 0, finished = true;
  for (const sh of sheets) {
    if (Date.now() - t0 > LAYOUT_TIME_BUDGET_MS) { finished = false; break; }
    const last = sh.getLastRow();
    if (last < DATA_START_ROW) continue;
    const range = sh.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 1);
    const notes = range.getNotes();
    let hit = 0;
    const cleaned = notes.map((r, i) => {
      if (r[0] !== AUTO_MARKER) return [r[0]];
      markAutoRows(sh, DATA_START_ROW + i, 1);
      hit++;
      return [''];
    });
    if (hit > 0) { range.setNotes(cleaned); tabs++; rowsFixed += hit; }
  }
  Logger.log(`目印メモの置き換え: ${tabs}タブ / ${rowsFixed}行 / ${finished ? '完了' : '未完（再実行してください）'}`);
  finishPopup(true, `目印メモ（A列の黒い印）を削除しました。\n${tabs}タブ / ${rowsFixed}行` +
    (finished ? '' : '\nまだ残りがあります。もう一度実行してください。'));
}

// フッター開始位置（「合計」行 or AM/PM集計行）を探す。無ければ0
//   ※患者行に紛れないよう、集計行は「AM/PM」と「人」を同時に含む行のみ検出
function findFooterRow(sheet) {
  const last = sheet.getLastRow();
  if (last < DATA_START_ROW) return 0;
  const vals = sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, TOTAL_COLS).getValues();
  for (let i = 0; i < vals.length; i++) {
    const t = vals[i].map(v => String(v)).join('');
    const isFooter = t.indexOf('合計') !== -1 || t.indexOf('合　計') !== -1 ||
      ((t.indexOf('AM') !== -1 || t.indexOf('ＡＭ') !== -1 || t.indexOf('PM') !== -1 || t.indexOf('ＰＭ') !== -1) && t.indexOf('人') !== -1);
    if (isFooter) return DATA_START_ROW + i;
  }
  return 0;
}

// 書き込み開始行：フッター手前で、A列が空の最初の行
function getWriteStart(sheet, footer) {
  const last    = sheet.getLastRow();
  const scanEnd = footer > 0 ? footer - 1 : last;
  if (scanEnd < DATA_START_ROW) return DATA_START_ROW;
  const colA = sheet.getRange(DATA_START_ROW, 1, scanEnd - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] === '' || colA[i][0] === null) return DATA_START_ROW + i;
  }
  // 手前に空きが無い → フッター位置（そこに挿入して書く）／フッター無しなら末尾
  return footer > 0 ? footer : last + 1;
}

// 必要行数を確保する。フッターがあれば「合計範囲の内側」に不足分を挿入し書式もコピー、無ければ行数拡張
//   ※合計の1つ上（=SUM範囲の最終行）の手前に挿入することで、=SUM(H3:H22)→=SUM(H3:H31) と自動拡張させる
function ensureRoom(sheet, startRow, count, footer) {
  if (footer > 0) {
    const available = footer - startRow;         // startRow〜footer-1 の空き
    if (count > available) {
      const need = count - available;
      const insertAt = Math.max(footer - 1, startRow); // 合計の1つ上（SUM範囲内）に挿入
      sheet.insertRowsBefore(insertAt, need);
      // 挿入直後、新規行は [insertAt .. insertAt+need-1]。既存予定行の書式(罫線等)をコピー
      try {
        const srcRow = (startRow < insertAt) ? startRow : DATA_START_ROW; // 書式の見本行
        sheet.getRange(srcRow, 1, 1, TOTAL_COLS)
             .copyTo(sheet.getRange(insertAt, 1, need, TOTAL_COLS), { formatOnly: true });
        // 挿入行は直前行の高さを継承するため、明示的に統一する
        sheet.setRowHeights(insertAt, need, ROW_HEIGHT_DATA);
      } catch (e) { Logger.log(`書式コピー警告: ${e.message}`); }
    }
  } else {
    const needLast = startRow + count - 1;
    const maxRows  = sheet.getMaxRows();
    if (needLast > maxRows) sheet.insertRowsAfter(maxRows, needLast - maxRows);
  }
}


// ============================================================
// 在宅判定（施設名が空 or 在宅/居宅を含む → 在宅）
// ============================================================
function isHome(facilityName) {
  const f = (facilityName || '').trim();
  if (f === '') return true;
  return HOME_KEYWORDS.some(kw => f.includes(kw));
}


// ============================================================
// タイトルから施設名を判定（マスタの施設名に含まれれば施設訪問）
//   長い施設名を優先して照合する（「東病院」と「とくしま医療センター東病院」の取り違え防止）
// ============================================================
function detectFacility(title, master) {
  const cands = master.facilities
    .filter(f => f && !isHome(f))
    .sort((a, b) => b.length - a.length);
  for (const f of cands) {
    if (title.includes(f)) return f;
  }
  return '';
}


// ============================================================
// F4 名寄せ：タイトルから患者を「逆引き」で特定（患者ごとに複数返す）
//  1) 患者番号（3桁以上）でマスタ照合
//  2) 氏名の部分一致でマスタ照合（正規化後）
//  いずれも候補が複数あるときは、タイトル中の施設名で絞り込み、
//  決着しなければ ambiguous（要確認）として返す。
// ============================================================
function extractPatientsFromTitle(title, master) {
  const cleaned = toHalfWidth(title)
    .replace(/\d{1,2}[:：]\d{2}\s*(頃|ごろ|前後|くらい)?/g, ' ') // 時刻除去
    .replace(/[「」『』【】\[\]()（）]/g, ' ');
  const normTitle    = normalizeStr(cleaned);
  const facilityHint = detectFacility(title, master);

  const results = [];
  const seen    = new Set();

  // 候補配列から1件に決める（施設ヒントで絞込）。決まらなければ null
  const pick = (cands, label) => {
    if (cands.length === 1) return cands[0];
    if (facilityHint) {
      const narrowed = cands.filter(r => r.facility === facilityHint);
      if (narrowed.length === 1) return narrowed[0];
    }
    return null;
  };

  // 1) 氏名の部分一致（2文字以上）。同姓同名は施設ヒントで絞込
  //    ※氏名を先に確定させることで、番号側の重複判定を抑制できる
  //      （例:「7630藤澤明」は氏名で確定するので、番号重複の要確認は出さない）
  const nameHits = new Map(); // normName → rec[]
  master.list.forEach(rec => {
    if (rec.normName.length >= 2 && normTitle.includes(rec.normName)) {
      if (!nameHits.has(rec.normName)) nameHits.set(rec.normName, []);
      nameHits.get(rec.normName).push(rec);
    }
  });
  nameHits.forEach((cands, normName) => {
    const rec = pick(cands);
    if (rec) {
      if (!seen.has(rec.key)) { seen.add(rec.key); results.push(rec); }
    } else {
      const ambKey = 'amb_name_' + normName;
      if (!seen.has(ambKey)) {
        seen.add(ambKey);
        results.push({
          ambiguous: true, facilityHint,
          label: `${cands[0].patientName}（候補${cands.length}件）`,
          reason: `同姓同名候補: ${cands[0].patientName} → ` +
                  cands.map(r => `[${r.facility}]№${r.patientNo}`).join(' / '),
        });
      }
    }
  });

  // 2) 患者番号（3桁以上）
  (cleaned.match(/\d{3,}/g) || []).forEach(num => {
    const cands = master.byNumber.get(num);
    if (!cands || cands.length === 0) return;
    // すでに氏名で確定済みの患者なら、番号側は処理しない（重複行の防止）
    if (cands.some(r => seen.has(r.key))) return;

    let rec = pick(cands);
    // 施設ヒントで決まらない場合、候補の氏名がタイトルに含まれていればそれを採用
    if (!rec) {
      const byName = cands.filter(r => r.normName.length >= 2 && normTitle.includes(r.normName));
      if (byName.length === 1) rec = byName[0];
    }
    if (rec) {
      if (!seen.has(rec.key)) { seen.add(rec.key); results.push(rec); }
    } else {
      const ambKey = 'amb_no_' + num;
      if (!seen.has(ambKey)) {
        seen.add(ambKey);
        results.push({
          ambiguous: true, facilityHint,
          label: `№${num}（候補${cands.length}件）`,
          reason: `カルテ番号複数候補: №${num} → ` +
                  cands.map(r => `[${r.facility}]${r.patientName}`).join(' / '),
        });
      }
    }
  });

  return results;
}


// ============================================================
// F3 患者マスタ構築（キャッシュ優先）
//   rec = { patientNo, patientName, normName, folderId, facility, ward, isHome, key }
// ============================================================
function buildPatientMaster(ss) {
  if (USE_CACHE) {
    const cached = loadMasterCache();
    if (cached) { Logger.log(`患者マスタ: キャッシュ利用（${cached.list.length}件）`); return cached; }
  }
  const master = scanPatientMaster();
  if (USE_CACHE && master.list.length > 0) saveMasterCache(master);
  return master;
}

// 患者マスタを作り直してキャッシュに保存する（日次実行を軽くするための事前構築）
function prebuildPatientMaster() {
  const t0 = Date.now();
  clearMasterCacheQuiet();
  const master = scanPatientMaster();
  if (master.list.length > 0) saveMasterCache(master);
  const sec = Math.round((Date.now() - t0) / 1000);
  Logger.log(`事前構築完了: 患者${master.list.length}件 / 施設${master.facilities.length}件 / ${sec}秒`);
  if (master.unmatched.length > 0) {
    Logger.log(`※ 命名規則に合わず登録できなかったフォルダ ${master.unmatched.length}件（先頭20件）:\n  ` +
      master.unmatched.slice(0, 20).join('\n  '));
  }
  finishPopup(true,
    `患者マスタを構築しました。\n` +
    `患者: ${master.list.length}件 / 施設: ${master.facilities.length}件\n` +
    `所要: ${sec}秒\n` +
    `未登録フォルダ: ${master.unmatched.length}件（詳細は実行ログ）`);
}

// 実際にドライブを走査してマスタを構築
function scanPatientMaster() {
  const master = { list: [], byNumber: new Map(), facilities: [], unmatched: [], failedRoots: [] };
  const facSet = new Set();

  ROOT_FOLDER_IDS.forEach(entry => scanOneRoot(entry, master, facSet));

  master.facilities = Array.from(facSet);
  return master;
}

// ROOT 1件を走査してマスタへ加える
//   entry: 文字列（自動判別・従来動作） または { id, name }（施設名固定・再帰走査）
function scanOneRoot(entry, master, facSet) {
  const conf   = (typeof entry === 'string') ? { id: entry } : (entry || {});
  const rootId = conf.id;

  let root;
  try {
    root = withRetry(() => DriveApp.getFolderById(rootId), 'getFolderById');
  } catch (e) {
    Logger.log(`【エラー】フォルダ取得失敗 [${rootId}]${conf.name ? ' ' + conf.name : ''}: ${e.message}`);
    master.failedRoots.push(`${conf.name || ''}[${rootId}] ${e.message}`);
    return;
  }

  // ② 施設名を明示指定：配下を MAX_SCAN_DEPTH 階層まで再帰走査（病棟フォルダ対応）
  if (conf.name) {
    facSet.add(conf.name);
    scanFacilityTree(root, conf.name, '', 1, master, facSet);
    return;
  }

  // ① 従来の自動判別（既存4件の挙動を変えない）
  const rootFacility = stripBrackets(root.getName());
  const it = withRetry(() => root.getFolders(), 'root.getFolders');
  while (it.hasNext()) {
    const child = it.next();
    if (/^\s*\d/.test(toHalfWidth(child.getName()))) {
      // 患者フォルダが直下にある → ROOT自体を施設とみなす
      addPatientFolder(master, child, rootFacility, facSet, '');
    } else {
      // 施設フォルダ → その配下の患者を走査
      const facility = stripBrackets(child.getName());
      facSet.add(facility);
      const patIt = child.getFolders();
      while (patIt.hasNext()) addPatientFolder(master, patIt.next(), facility, facSet, '');
    }
  }
}

// 施設フォルダ配下を再帰走査する
//   「番号+氏名」形式 → 患者フォルダとして登録
//   それ以外          → 病棟などの中間フォルダとみなして1階層下る（MAX_SCAN_DEPTHまで）
// @return この配下で登録できた患者数（0なら中間フォルダではなかった可能性が高い）
function scanFacilityTree(folder, facility, ward, depth, master, facSet) {
  let added = 0;
  const it = withRetry(() => folder.getFolders(), 'getFolders');
  while (it.hasNext()) {
    const child = it.next();
    const rawName = child.getName();
    const here = `${facility}${ward ? '/' + ward : ''}/${rawName}`;
    if (/^\s*\d/.test(toHalfWidth(rawName))) {
      if (addPatientFolder(master, child, facility, facSet, ward)) added++;
    } else if (depth < MAX_SCAN_DEPTH) {
      const w = ward ? `${ward}/${stripBrackets(rawName)}` : stripBrackets(rawName);
      const n = scanFacilityTree(child, facility, w, depth + 1, master, facSet);
      if (n === 0) master.unmatched.push(`${here}（配下に患者フォルダなし）`);
      added += n;
    } else {
      master.unmatched.push(`${here}（階層上限${MAX_SCAN_DEPTH}に到達）`);
    }
  }
  return added;
}

// 患者フォルダ1件をマスタへ登録（番号+氏名を抽出）
// @return 登録できたら true
function addPatientFolder(master, patFolder, facility, facSet, ward) {
  const raw  = patFolder.getName();
  const half = toHalfWidth(raw);
  const m = half.match(/^\s*(\d+)[_＿]?\s*(.+)$/);
  if (!m) {
    master.unmatched.push(`${facility}${ward ? '/' + ward : ''}/${raw}（番号+氏名の形式でない）`);
    return false;
  }
  const patientNo   = m[1];
  const patientName = m[2].split(/[【(\[（_＿]/)[0].replace(/[　\s]+/g, '').trim();
  addMasterRec(master, {
    patientNo, patientName, folderId: patFolder.getId(),
    facility, ward: ward || '', isHome: isHome(facility),
  });
  facSet.add(facility);
  return true;
}

// マスタへ1件追加（キー生成・索引登録を共通化）
//   byNumber は「番号 → 候補配列」。施設が増えると番号衝突が起こるため配列で保持する。
function addMasterRec(master, o) {
  const rec = {
    patientNo  : o.patientNo,
    patientName: o.patientName,
    normName   : normalizeStr(o.patientName),
    folderId   : o.folderId,
    facility   : o.facility,
    ward       : o.ward || '',
    isHome     : o.isHome,
    key        : o.facility + '/' + o.folderId,
  };
  master.list.push(rec);
  if (!master.byNumber.has(rec.patientNo)) master.byNumber.set(rec.patientNo, []);
  master.byNumber.get(rec.patientNo).push(rec);
  return rec;
}


// ============================================================
// F3 キャッシュ（CacheService＝メモリ上・シートを増やさない）
//   ※このスプレッドシートはセル数が上限近いため、シートは追加しない
//   ※患者数が増えて100KBを超えると保存できなくなるため、分割して保存する
// ============================================================
// キャッシュキーに「日付」＋「ROOT_FOLDER_IDSのハッシュ」を含める。
// → 施設フォルダを追加/変更すると自動的に別キーになり、キャッシュが作り直される
function rootSignature() {
  return ROOT_FOLDER_IDS
    .map(e => (typeof e === 'string') ? e : `${e.id}:${e.name || ''}`)
    .join(',');
}
function cacheKeyBase() {
  return 'patientMaster_' + fmtDate(new Date()) + '_' + simpleHash(rootSignature());
}
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h >>> 0);
}

function loadMasterCache() {
  try {
    const cache = CacheService.getScriptCache();
    const base  = cacheKeyBase();
    const nStr  = cache.get(base + '_n');
    if (!nStr) return null;
    const n = Number(nStr);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(base + '_' + i);
    const parts = cache.getAll(keys);
    let raw = '';
    for (let i = 0; i < n; i++) {
      const chunk = parts[base + '_' + i];
      if (chunk == null) return null; // 一部が期限切れ → 作り直す
      raw += chunk;
    }
    const arr = JSON.parse(raw); // [[no,name,facility,isHome,folderId,ward], ...]
    const master = { list: [], byNumber: new Map(), facilities: [], unmatched: [], failedRoots: [] };
    const facSet = new Set();
    arr.forEach(r => {
      addMasterRec(master, {
        patientNo: r[0], patientName: r[1], facility: r[2],
        isHome: r[3], folderId: r[4], ward: r[5] || '',
      });
      facSet.add(r[2]);
    });
    master.facilities = Array.from(facSet);
    return master.list.length > 0 ? master : null;
  } catch (e) {
    Logger.log(`キャッシュ読込失敗: ${e.message}`);
    return null;
  }
}

function saveMasterCache(master) {
  try {
    const arr = master.list.map(r => [r.patientNo, r.patientName, r.facility, r.isHome, r.folderId, r.ward]);
    const raw = JSON.stringify(arr);
    const cache = CacheService.getScriptCache();
    const base  = cacheKeyBase();
    const obj   = {};
    let n = 0;
    for (let i = 0; i < raw.length; i += CACHE_CHUNK_SIZE) {
      obj[base + '_' + n] = raw.substring(i, i + CACHE_CHUNK_SIZE);
      n++;
    }
    obj[base + '_n'] = String(n);
    cache.putAll(obj, CACHE_TTL_SEC);
    Logger.log(`キャッシュ保存: ${raw.length}文字 / ${n}分割`);
  } catch (e) {
    Logger.log(`キャッシュ保存失敗: ${e.message}`);
  }
}

function clearMasterCacheQuiet() {
  try {
    const cache = CacheService.getScriptCache();
    const base  = cacheKeyBase();
    const nStr  = cache.get(base + '_n');
    const keys  = [base + '_n'];
    const n = nStr ? Number(nStr) : 20; // 件数不明時も念のため先頭20チャンクを削除
    for (let i = 0; i < n; i++) keys.push(base + '_' + i);
    cache.removeAll(keys);
  } catch (e) { Logger.log(`キャッシュ削除失敗: ${e.message}`); }
}

function clearMasterCache() {
  clearMasterCacheQuiet();
  finishPopup(true, '患者マスタのキャッシュを削除しました。次回実行時に再構築します。');
}


// ============================================================
// F1 カレンダー収集（終日予定・空タイトル・非患者ワードを除外）
// ============================================================
function collectAllEvents(startTime, endTime) {
  const collected = [];

  for (const pair of PAIR_CALENDARS) {
    try {
      const calendar = CalendarApp.getCalendarById(pair.id);
      if (!calendar) { Logger.log(`⚠ カレンダーが見つかりません: ${pair.dr}・${pair.dh}`); continue; }

      const events = withRetry(() => calendar.getEvents(startTime, endTime), 'getEvents');
      Logger.log(`${pair.dr}・${pair.dh}: ${events.length}件`);

      for (const event of events) {
        if (event.isAllDayEvent()) continue;              // F1: 終日予定は除外
        const title = event.getTitle().trim();
        if (!title) continue;                              // F1: タイトル未記入は除外
        if (isNonPatientTitle(title)) continue;

        collected.push({
          title    : title,
          startTime: event.getStartTime(),
          timeStr  : Utilities.formatDate(event.getStartTime(), 'Asia/Tokyo', 'HH:mm'),
          dr       : pair.dr,
          dh       : pair.dh,
        });
      }
    } catch (e) {
      Logger.log(`カレンダー取得エラー (${pair.dr}・${pair.dh}): ${e.message}`);
    }
  }
  return collected;
}


// ============================================================
// F3.5 患者フォルダ内の最新GoogleドキュメントのURLを取得
// @return {url, name} または null
// ============================================================
function getLatestDoc(folderId) {
  return withRetry(() => {
    const folder = DriveApp.getFolderById(folderId);
    const files  = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    let latest = null, latestT = 0;
    while (files.hasNext()) {
      const f = files.next();
      const t = f.getLastUpdated().getTime();
      if (t > latestT) { latestT = t; latest = f; }
    }
    return latest ? { id: latest.getId(), url: latest.getUrl(), name: latest.getName() } : null;
  }, 'getLatestDoc');
}


// ============================================================
// 最新カルテから治療内容の本文を抽出
//   CONTENT_MODE='text'（本文をそのまま転記）と 'label'（短い単語に変換）で使用
// ============================================================
function getLastBusinessContent(folderId) {
  const doc = getLatestDoc(folderId);
  if (!doc) return null;
  return extractBusinessContent(doc.id);
}

// ドキュメント本文から「前回業務内容」等の見出し直後の段落を取り出す（見つからなければ ''）
function extractBusinessContent(docId) {
  const paragraphs = withRetry(() => DocumentApp.openById(docId).getBody().getParagraphs(), 'openDoc');
  let capturing = false;
  const lines = [];
  for (const para of paragraphs) {
    const text = para.getText().trim();
    if (capturing) {
      if (para.getHeading() !== DocumentApp.ParagraphHeading.NORMAL && text !== '') break;
      if (text !== '' && CONTENT_HEADINGS.some(kw => text === kw)) break;
      if (text !== '') lines.push(text);
    }
    if (!capturing && CONTENT_HEADINGS.some(kw => text.includes(kw))) capturing = true;
  }
  return lines.join('\n');
}

// 治療内容の文章 → E列に出す短い単語（例:「義歯」「義歯・ケア」）
//   CONTENT_LABEL_RULES に当てはまる単語を上から最大 CONTENT_LABEL_MAX 個。
//   どれにも当てはまらなければ、記録の1行目の先頭 CONTENT_FALLBACK_CHARS 文字。空なら ''
function makeContentLabel(text) {
  const src = toHalfWidth(text || '');
  if (!src.trim()) return '';
  const labels = [];
  for (const rule of CONTENT_LABEL_RULES) {
    if (labels.length >= CONTENT_LABEL_MAX) break;
    if (rule.words.some(w => containsWord(src, w))) labels.push(rule.label);
  }
  if (labels.length > 0) return labels.join('・');
  const first = src.split('\n')[0].trim();
  return first.length > CONTENT_FALLBACK_CHARS ? first.slice(0, CONTENT_FALLBACK_CHARS) + '…' : first;
}

// 単語を含むか。英数字だけの単語は、前後が英字でないときだけ一致（大文字小文字は区別しない）
function containsWord(src, word) {
  const w = toHalfWidth(word);
  if (/^[A-Za-z0-9]+$/.test(w)) {
    return new RegExp(`(^|[^A-Za-z])${w}(?![A-Za-z])`, 'i').test(src);
  }
  return src.indexOf(w) !== -1;
}


// ============================================================
// 患者ではない予定の判定
// ============================================================
// NON_PATIENT_KEYWORDS を含むか（大文字/小文字・全角/半角を区別しない）
function isNonPatientTitle(title) {
  const t = toHalfWidth(title).toLowerCase();
  return NON_PATIENT_KEYWORDS.some(kw => t.indexOf(toHalfWidth(kw).toLowerCase()) !== -1);
}

// 日本語（漢字/ひらがな/カタカナ）も3桁以上の番号も含まない（例:「PCM」「Dr. Visit」）
//   → 氏名・カルテ番号になり得ないため、患者の予定ではないとみなす
function looksNonPatient(title) {
  const t = toHalfWidth(title);
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々]/.test(t);
  const hasNumber   = /\d{3,}/.test(t);
  return !hasJapanese && !hasNumber;
}


// ============================================================
// F7 アクセスログ（メタ情報のみ・氏名等は記録しない）
// ============================================================
function writeAccessLog(ss, summary) {
  try {
    let sh = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(LOG_SHEET_NAME);
      sh.appendRow(['実行日時', '実行者', '対象日', '転記件数', '要確認件数', 'エラー件数']);
    }
    let executor = '';
    try { executor = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; } catch (e) {}
    sh.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      executor, summary.targetDate,
      summary.written, summary.review, summary.errors,
    ]);
  } catch (e) {
    Logger.log(`アクセスログ記録エラー: ${e.message}`);
  }
}


// ============================================================
// 日付タブ名を生成： R{令和年}_{月}月{日}日({曜日}) 例: R8_7月6日(月)
// 括弧の全角/半角どちらでも当たるよう候補を2種返す
// ============================================================
function buildDateSheetNames(date) {
  const reiwa   = date.getFullYear() - 2018;
  const month   = date.getMonth() + 1;
  const day     = date.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  const base    = `R${reiwa}_${month}月${day}日`;
  return [`${base}(${weekday})`, `${base}（${weekday}）`];
}


// ============================================================
// 次の書き込み行（A列が空の最初の行）
// ============================================================
function getNextWriteRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return DATA_START_ROW;
  const numRows = lastRow - DATA_START_ROW + 1;
  const colA = sheet.getRange(DATA_START_ROW, 1, numRows, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] === '' || colA[i][0] === null) return DATA_START_ROW + i;
  }
  return lastRow + 1;
}


// ============================================================
// 7.1 リトライ（API一時エラー時に最大MAX_RETRY回）
// ============================================================
function withRetry(fn, label) {
  let lastErr;
  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      Logger.log(`リトライ(${label}) ${i}/${MAX_RETRY}: ${e.message}`);
      if (i < MAX_RETRY) Utilities.sleep(500 * i);
    }
  }
  throw lastErr;
}


// ============================================================
// 文字列ユーティリティ
// ============================================================
function toHalfWidth(str) {
  return String(str == null ? '' : str)
    .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}
function stripBrackets(str) {
  return String(str == null ? '' : str).replace(/[【】\[\]（）()]/g, '').trim();
}
function normalizeStr(str) {
  return toHalfWidth(str)
    .replace(/[\s　]+/g, '')
    .replace(/[・･,，、.．]/g, '')
    .toLowerCase();
}
function fmtDate(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}
function finishPopup(show, message) {
  if (!show) return;
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { /* UI不可の環境では無視 */ }
}


// ============================================================
// ▼ レイアウト正規化（行高さ／列幅）
//   日付タブが多数あり1回の実行では6分制限に収まらないため、
//   時間予算内で処理して進捗を保存し、再実行で続きから処理する。
//   ・対象: 3行目〜フッター(合計行)の1つ前
//   ・タイトル行(1〜2行目)と合計行の高さは触らない
// ============================================================
function normalizeLayout() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets().filter(sh => DAY_TAB_RE.test(sh.getName()));
  const props = PropertiesService.getDocumentProperties();
  let start = Number(props.getProperty(LAYOUT_PROP_KEY) || 0);
  if (start >= sheets.length) start = 0; // 完了済み → 最初から

  // 列幅の見本（必要な場合のみ）
  let widths = null;
  if (NORMALIZE_COL_WIDTH) {
    const tpl = COL_WIDTH_TEMPLATE
      ? ss.getSheetByName(COL_WIDTH_TEMPLATE)
      : sheets[0];
    if (tpl) {
      widths = [];
      for (let c = 1; c <= TOTAL_COLS; c++) widths.push(tpl.getColumnWidth(c));
      Logger.log(`列幅の見本: 「${tpl.getName()}」 → ${widths.join(',')}`);
    }
  }

  let done = 0, changed = 0;
  let i = start;
  for (; i < sheets.length; i++) {
    if (Date.now() - t0 > LAYOUT_TIME_BUDGET_MS) break; // 時間予算切れ → 中断して進捗保存
    const sh = sheets[i];
    try {
      const footer = findFooterRow(sh);
      const last   = sh.getLastRow();
      const endRow = (footer > 0 ? footer - 1 : last);
      const num    = endRow - DATA_START_ROW + 1;
      if (num > 0) {
        sh.setRowHeights(DATA_START_ROW, num, ROW_HEIGHT_DATA);
        changed++;
      }
      if (widths) {
        for (let c = 1; c <= TOTAL_COLS; c++) {
          if (sh.getColumnWidth(c) !== widths[c - 1]) sh.setColumnWidth(c, widths[c - 1]);
        }
      }
    } catch (e) {
      Logger.log(`レイアウト正規化エラー 「${sh.getName()}」: ${e.message}`);
    }
    done++;
  }

  props.setProperty(LAYOUT_PROP_KEY, String(i));
  const finished = i >= sheets.length;
  const sec = Math.round((Date.now() - t0) / 1000);
  Logger.log(`レイアウト正規化: ${start + 1}〜${i}/${sheets.length}タブ（高さ変更${changed}） ${sec}秒 / ${finished ? '完了' : '未完（再実行してください）'}`);
  finishPopup(true,
    `レイアウト正規化\n` +
    `処理: ${start + 1}〜${i} / 全${sheets.length}タブ\n` +
    `所要: ${sec}秒\n` +
    (finished
      ? '全タブ完了しました。'
      : 'まだ残りがあります。もう一度「レイアウト正規化（行高さ）」を実行してください。'));
}

function resetLayoutProgress() {
  PropertiesService.getDocumentProperties().deleteProperty(LAYOUT_PROP_KEY);
  finishPopup(true, 'レイアウト正規化の進捗をリセットしました。次回は最初のタブから処理します。');
}

// 現状の行高さを数タブ分だけサンプル表示（getRowHeightは1行1呼び出しで重いため件数を絞る）
function diagnoseRowHeights() {
  const SAMPLE_TABS = 5;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const dayTabs = sheets.filter(sh => DAY_TAB_RE.test(sh.getName()));
  Logger.log(`全シート${sheets.length}枚 / 日付タブ${dayTabs.length}枚（判定: ${DAY_TAB_RE}）`);
  if (dayTabs.length === 0) {
    Logger.log('日付タブが検出できません。DAY_TAB_RE を実際のタブ名に合わせて調整してください。');
    Logger.log(`参考: 先頭5シート名 → ${sheets.slice(0, 5).map(s => s.getName()).join(' / ')}`);
    finishPopup(true, '日付タブを検出できませんでした。実行ログを確認してください。');
    return;
  }
  dayTabs.slice(0, SAMPLE_TABS).forEach(sh => {
    const footer = findFooterRow(sh);
    const last   = sh.getLastRow();
    const endRow = (footer > 0 ? footer - 1 : last);
    const heights = [];
    for (let r = 1; r <= Math.min(endRow + 1, sh.getMaxRows()); r++) heights.push(`${r}:${sh.getRowHeight(r)}`);
    const dataH = new Set();
    for (let r = DATA_START_ROW; r <= endRow; r++) dataH.add(sh.getRowHeight(r));
    Logger.log(`「${sh.getName()}」 フッター=${footer || '未検出'} / データ行の高さ種類=${Array.from(dataH).join(',')} / 全行=${heights.join(' ')}`);
  });
  finishPopup(true, `先頭${Math.min(SAMPLE_TABS, dayTabs.length)}タブの行高さを実行ログに出力しました。\n日付タブ総数: ${dayTabs.length}`);
}


// ============================================================
// 【診断用】患者マスタが読めているか・照合が効くか確認
// ============================================================
function diagnosePatientFolders() {
  Logger.log('=== 患者マスタ診断 開始 ===');

  // ROOTフォルダの生アクセス確認（全ID）
  ROOT_FOLDER_IDS.forEach(entry => {
    const conf = (typeof entry === 'string') ? { id: entry } : entry;
    try {
      const root = DriveApp.getFolderById(conf.id);
      let n = 0; const names = [];
      const it = root.getFolders();
      while (it.hasNext()) { const f = it.next(); n++; if (names.length < 10) names.push(f.getName()); }
      const label = conf.name ? `${conf.name}（実フォルダ名:「${root.getName()}」）` : `「${root.getName()}」`;
      Logger.log(`ROOT ${label} 直下${n}件: ${names.join(' / ') || '(0件)'}`);
    } catch (e) {
      Logger.log(`【ROOTアクセスエラー】${conf.name || ''}[${conf.id}] ${e.message}`);
    }
  });

  const master = scanPatientMaster(); // 診断は常にライブ走査

  Logger.log(`施設フォルダ(${master.facilities.length}件): ${master.facilities.join(' / ')}`);
  Logger.log(`患者マスタ登録数: ${master.list.length}`);
  const samples = master.list.slice(0, 20).map(r => `[${r.facility}${r.ward ? '/' + r.ward : ''}]${r.patientNo}${r.patientName}`);
  Logger.log(`患者サンプル(最大20件): ${samples.join(' / ') || '(0件)'}`);

  // 施設ごとの登録件数（0件の施設＝命名規則が違う可能性あり）
  const perFac = {};
  master.list.forEach(r => { perFac[r.facility] = (perFac[r.facility] || 0) + 1; });
  master.facilities.forEach(f => {
    const n = perFac[f] || 0;
    Logger.log(`  施設別: ${f} → ${n}件${n === 0 ? '  ★0件（命名規則・アクセス権を確認）' : ''}`);
  });

  // カルテ番号の重複（施設が増えると衝突しやすい）
  const dup = [];
  master.byNumber.forEach((cands, no) => {
    if (cands.length > 1) dup.push(`№${no}: ` + cands.map(r => `[${r.facility}]${r.patientName}`).join(' / '));
  });
  Logger.log(`カルテ番号の重複: ${dup.length}件${dup.length ? '\n  ' + dup.slice(0, 20).join('\n  ') : ''}`);

  // 同姓同名
  const byName = new Map();
  master.list.forEach(r => {
    if (!byName.has(r.normName)) byName.set(r.normName, []);
    byName.get(r.normName).push(r);
  });
  const sameName = [];
  byName.forEach((cands, n) => {
    if (cands.length > 1) sameName.push(`${cands[0].patientName}: ` + cands.map(r => `[${r.facility}]№${r.patientNo}`).join(' / '));
  });
  Logger.log(`同姓同名: ${sameName.length}件${sameName.length ? '\n  ' + sameName.slice(0, 20).join('\n  ') : ''}`);

  // 登録できなかったフォルダ
  if (master.unmatched.length > 0) {
    Logger.log(`未登録フォルダ ${master.unmatched.length}件（先頭30件）:\n  ` + master.unmatched.slice(0, 30).join('\n  '));
  }
  if (master.failedRoots.length > 0) {
    Logger.log(`アクセスできなかったROOT ${master.failedRoots.length}件:\n  ` + master.failedRoots.join('\n  '));
  }

  const testTitles = [
    '藍寿苑、林天子、佐藤初夫、大岸寿美、',
    '13：00東病院2、7630藤澤明',
    '14：00前後野中幸子',
    '戎井茂個人トレーで上顎印象',
    '小笠原由美子',
    '鳴門病院',
    '10:00 メディション凌雲',
  ];
  testTitles.forEach(t => {
    const ps = extractPatientsFromTitle(t, master);
    const shown = ps.map(p => p.ambiguous
      ? `【要確認】${p.reason}`
      : `[${p.facility || '在宅'}]${p.patientNo}${p.patientName}`).join(', ');
    Logger.log(`「${t}」→ ${shown || '(患者なし)'}`);
  });

  // F3.5 リンク取得テスト（先頭患者1名）
  if (master.list.length > 0) {
    const doc = getLatestDoc(master.list[0].folderId);
    Logger.log(`リンク取得テスト [${master.list[0].patientName}] → ${doc ? doc.url : '記録ファイル未検出'}`);
  }

  Logger.log('=== 患者マスタ診断 終了 ===');
  finishPopup(true,
    `患者マスタ: ${master.list.length}件 / 施設: ${master.facilities.length}件\n` +
    `番号重複: ${dup.length}件 / 同姓同名: ${sameName.length}件\n` +
    `未登録フォルダ: ${master.unmatched.length}件\n` +
    `詳細は実行ログを確認してください。`);
}


// ============================================================
// 【導入用】追加した施設フォルダIDが実際に開けるか一括確認
//   アクセス権・IDの打ち間違い・階層構造をまとめて点検する
// ============================================================
function testFacilityFolders() {
  Logger.log('=== 施設フォルダ 一括確認 開始 ===');
  let ok = 0, ng = 0;
  ROOT_FOLDER_IDS.forEach(entry => {
    const conf = (typeof entry === 'string') ? { id: entry } : entry;
    try {
      const f = DriveApp.getFolderById(conf.id);
      const children = [];
      let numeric = 0, nonNumeric = 0;
      const it = f.getFolders();
      while (it.hasNext()) {
        const c = it.next();
        if (/^\s*\d/.test(toHalfWidth(c.getName()))) numeric++; else nonNumeric++;
        if (children.length < 5) children.push(c.getName());
      }
      const shape = numeric > 0
        ? `患者フォルダ直下(${numeric}件)`
        : `中間フォルダのみ(${nonNumeric}件) → 病棟等の可能性`;
      Logger.log(`✓ ${conf.name || '(自動判別)'} [${conf.id}] 実名「${f.getName()}」 / ${shape} / 例: ${children.join(' / ')}`);
      ok++;
    } catch (e) {
      Logger.log(`✗ ${conf.name || '(自動判別)'} [${conf.id}] → ${e.message}`);
      ng++;
    }
  });
  Logger.log(`=== 完了: 開けた ${ok}件 / 開けなかった ${ng}件 ===`);
  finishPopup(true, `施設フォルダ確認\n開けた: ${ok}件 / 開けなかった: ${ng}件\n詳細は実行ログを確認してください。`);
}


// ============================================================
// 【導入用】ROOT候補IDを実測して、正しい親フォルダを特定する
//   施設フォルダ（【藍寿苑】等）が直下に並ぶIDが正解
// ============================================================
function testRootCandidates() {
  const candidates = [
    '1r7Xg8Vg3hXNPqSqUoJgqq2j9Zw9oaWd1', // 先頭1あり（現状=訪問事務・空）
    'r7Xg8Vg3hXNPqSqUoJgqq2j9Zw9oaWd1',  // 先頭1なし（最初に設定した方）
  ];
  candidates.forEach(id => {
    try {
      const f = DriveApp.getFolderById(id);
      let n = 0; const names = [];
      const it = f.getFolders();
      while (it.hasNext()) { const c = it.next(); n++; if (names.length < 6) names.push(c.getName()); }
      Logger.log(`ID [${id}] → 「${f.getName()}」 直下${n}件: ${names.join(' / ')}`);
    } catch (e) {
      Logger.log(`ID [${id}] → エラー: ${e.message}`);
    }
  });
  Logger.log('※ 施設フォルダ（【藍寿苑】等）が直下に並ぶIDが正解です。');
}


// ============================================================
// 【復旧用】壊れた日付タブを、無傷タブのテンプレートで復元する
//   例: 7/6（壊れ）を 7/7（無傷）の枠・合計フッターで作り直す
//   ※タイトル行(1-2行目)と日付は元タブのまま。3行目以降を差し替え
// ============================================================
function repairDayTab() {
  const TARGET_DATE   = '2026-07-06'; // 復元したい日
  const TEMPLATE_DATE = '2026-07-07'; // 見本にする無傷の日

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const target   = findSheetByDateStr(ss, TARGET_DATE);
  const template = findSheetByDateStr(ss, TEMPLATE_DATE);
  if (!target || !template) { finishPopup(true, 'タブが見つかりません'); return; }

  // targetの3行目以降を全消去（内容・メモ）
  const tLast = target.getLastRow();
  if (tLast >= DATA_START_ROW) {
    target.getRange(DATA_START_ROW, 1, tLast - DATA_START_ROW + 1, TOTAL_COLS).clearContent();
    target.getRange(DATA_START_ROW, 1, tLast - DATA_START_ROW + 1, 1).clearNote();
  }
  // templateの3行目〜最終行を、内容＋書式ごとコピー（合計フッター含む）
  const sLast = template.getLastRow();
  template.getRange(DATA_START_ROW, 1, sLast - DATA_START_ROW + 1, TOTAL_COLS)
    .copyTo(target.getRange(DATA_START_ROW, 1, sLast - DATA_START_ROW + 1, TOTAL_COLS));
  // 行高さもテンプレに合わせる
  try {
    for (let r = DATA_START_ROW; r <= sLast; r++) target.setRowHeight(r, template.getRowHeight(r));
  } catch (e) { Logger.log(`行高さ復元警告: ${e.message}`); }

  Logger.log(`${TARGET_DATE} を ${TEMPLATE_DATE} のテンプレで復元しました（合計フッター含む）`);
  finishPopup(true, `${TARGET_DATE} タブを復元しました。\n続けて「転記テスト_7月6日」を実行してください。`);
}

function findSheetByDateStr(ss, ds) {
  const m = ds.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  for (const name of buildDateSheetNames(d)) {
    const sh = ss.getSheetByName(name);
    if (sh) return sh;
  }
  return null;
}


// ============================================================
// 【診断用】日付タブのレイアウト状態を確認（フッターの有無）
//   合計フッターが「未検出」のタブは、以前の上書きで壊れている
// ============================================================
function checkSheetLayout() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dates = ['2026-07-06', '2026-07-07', '2026-07-13', '2026-07-20'];
  dates.forEach(ds => {
    const m = ds.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let sheet = null;
    for (const name of buildDateSheetNames(d)) { sheet = ss.getSheetByName(name); if (sheet) break; }
    if (!sheet) { Logger.log(`${ds}: タブなし`); return; }
    const footer  = findFooterRow(sheet);
    Logger.log(`${ds} 「${sheet.getName()}」: 合計/集計フッター=${footer || '未検出(壊れている可能性)'} / 最終行=${sheet.getLastRow()} / 総行数=${sheet.getMaxRows()}`);
  });
}


// ============================================================
// カレンダーID確認用（導入時のみ）
// ============================================================
function getCalendarList() {
  CalendarApp.getAllCalendars().forEach(cal => {
    Logger.log(`名前: ${cal.getName()} / ID: ${cal.getId()}`);
  });
}


// ============================================================
// F6b 毎朝トリガー登録：手動で一度だけ実行すれば、以降は毎朝自動実行
//   毎朝 TRIGGER_HOUR 時台に「当日分」を自動転記する
//   ※施設22件を毎回ライブ走査すると重いため、マスタ事前構築も
//     日次トリガーに登録しておくと日中の実行が速くなる
// ============================================================
const TRIGGER_HOUR = 4; // 実行する時刻（時）。今は午前4時
const PREBUILD_HOUR = 3; // 患者マスタ事前構築の時刻（転記より前）

function setDailyTrigger() {
  // 既存の同名トリガーを削除（重複防止）
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncVisitSchedule' ||
                 t.getHandlerFunction() === 'prebuildPatientMasterSilent')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('prebuildPatientMasterSilent')
    .timeBased().everyDays(1).atHour(PREBUILD_HOUR).create();
  ScriptApp.newTrigger('syncVisitSchedule')
    .timeBased().everyDays(1).atHour(TRIGGER_HOUR).create();

  Logger.log(`✓ トリガー設定完了：毎朝${PREBUILD_HOUR}時台にマスタ構築、${TRIGGER_HOUR}時台に当日分を自動転記します。`);
  finishPopup(true, `毎朝${PREBUILD_HOUR}時台に患者マスタを構築し、${TRIGGER_HOUR}時台に「当日分」を自動転記するよう設定しました。`);
}

// トリガー用（ポップアップなし）
function prebuildPatientMasterSilent() {
  const t0 = Date.now();
  clearMasterCacheQuiet();
  const master = scanPatientMaster();
  if (master.list.length > 0) saveMasterCache(master);
  Logger.log(`事前構築(トリガー): 患者${master.list.length}件 / 施設${master.facilities.length}件 / ${Math.round((Date.now() - t0) / 1000)}秒`);
}
