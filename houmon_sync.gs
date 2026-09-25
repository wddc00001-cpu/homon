// ============================================================
// 訪問歯科 カレンダー → スプレッドシート 自動転記スクリプト
// バージョン: 10.2.0（要件定義書 v0.2 フェーズ1対応）
// 実行アカウント: wadadc.houmon@gmail.com
// 更新日: 2026-09-25
// ============================================================
// 【v10.2.0 の変更点】（本日分の試行結果を受けた修正）
//   1. E列(治療内容)を「ケア」「義歯」等の短い単語で表示
//      CONTENT_MODE='label'。単語の辞書は CONTENT_LABEL_RULES で調整する
//      書き込んだ行は折り返さず（はみ出しは切り詰め）、行の高さを強制的に揃える
//   2. 「PCM」等の患者ではない予定を転記しない
//      ・NON_PATIENT_KEYWORDS に PCM を追加し、大文字/小文字・全角/半角を区別せず判定
//      ・患者を特定できなかった予定は、業務用語(NON_NAME_WORDS)・時刻・記号を除いた残りに
//        人の名前らしい並び（漢字2文字以上／漢字1文字＋かな2文字以上）が無ければ除外
//        （施設名を含む予定・3桁以上の番号を含む予定は除外しない）。除外件数は完了ポップアップに表示
//   3. A列右上の黒い印（自動生成行の目印メモ）を廃止し、見えない「行メタデータ」に変更
//      既存タブに残っている目印メモは、実行時に自動でメタデータへ置き換える
//      （全日付タブを一括で消す場合はメニュー「目印メモの一括削除」）
//   4. 日付タブ・月まとめタブの自動作成（既存タブを見本に複製し、日付・曜日・合計式を書き換え）
//      ・転記時に対象日のタブが無ければ、その月のタブ（まとめ＋月〜土）を自動作成
//      ・メニュー「日付タブを先まで作成」で TABS_AHEAD_MONTHS か月先まで一括作成
//   5. 施設フォルダ・ペアカレンダーをスプレッドシートの「設定_施設」「設定_カレンダー」タブで管理
//      （スタッフがGASを触らずに追加・停止できる。設定タブが無い間はコード内の定数を使用）
//   6. 自動記入行の高さを既存タブと同じ 34px に変更（従来 21px で既存行と高さが違っていた）
//   7. E列は普通の文字で入力（リンクにしない。CONTENT_LABEL_AS_LINK=true でリンク化も可）。
//      記録は「記載のある一番新しいもの」を使う（当日分の白紙ドキュメントを飛ばす）
//   8. 転記後、最後の予定行のすぐ下に合計行を詰める（間の空行を削除。BLANK_ROWS_ABOVE_FOOTER で空行数を指定）
//      合計の =SUM 式は毎回「3行目〜合計行の1つ上」に書き直す（行の削除・挿入で #REF! や範囲ずれを起こさない）
//      行を挿入する際の書式コピー元を既存の予定行に修正（見出し行の書式が移るのを防止）
//   9. 氏名照合で旧字体・異体字を同じ字とみなす（斎/齋/齊、高/髙、崎/﨑 等。KANJI_VARIANTS）
//  10. 前回の治療内容の探し方を強化（見出しの言葉が患者ごとに違っても拾える）
//      行頭の日付で訪問ごとに区切って対象日より前の最新回 → 見出し → 最後の段落のまとまり の順
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
// ※v10.2 以降は「設定_施設」タブがあればそちらを使う（この配列は初期値・予備）。
//   メニュー「設定タブを作成（初回のみ）」でこの内容が設定タブに書き出される。
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

// ※v10.2 以降は「設定_カレンダー」タブがあればそちらを使う（この配列は初期値・予備）
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

// 氏名照合で「同じ字」とみなす旧字体・異体字（左の字 → 右の字にそろえてから照合する）
//   例: カレンダー「斎藤良子」とフォルダ「齋藤良子」を一致させる。
//   表示（予定表のD列）はフォルダ側の表記のまま。合わない字があればここに追加する。
const KANJI_VARIANTS = {
  '齋': '斎', '齊': '斎', '斉': '斎', '髙': '高', '﨑': '崎', '嵜': '崎', '碕': '崎',
  '邊': '辺', '邉': '辺', '澤': '沢', '濱': '浜', '濵': '浜', '廣': '広', '國': '国',
  '櫻': '桜', '眞': '真', '惠': '恵', '德': '徳', '黑': '黒', '冨': '富', '槇': '槙',
  '瀧': '滝', '龍': '竜', '壽': '寿', '實': '実', '榮': '栄', '條': '条', '兒': '児',
  '圓': '円', '關': '関', '靜': '静', '桒': '桑', '𠮷': '吉', '嶋': '島', '嶌': '島',
  '渕': '淵', '薮': '藪', '萬': '万', '學': '学', '會': '会', '彌': '弥', '禮': '礼',
  '曾': '曽', '增': '増', '豐': '豊', '峯': '峰', '賴': '頼', '瀨': '瀬', '鐵': '鉄',
  '藏': '蔵', '將': '将', '淺': '浅', '傳': '伝', '驒': '騨', '龜': '亀',
};

const NON_PATIENT_KEYWORDS = [
  '会議', 'ミーティング', '研修', '休み', '祝日', '休診',
  '院長', '副院長', 'mtg', 'MTG', '打ち合わせ', '勉強会',
  '学会', '出張', '健診', '検診', '移動', '準備',
  'PCM',
];
// ※判定は大文字/小文字・全角/半角を区別しない（'pcm' 'ＰＣＭ' も除外）。
//   ここの単語を含む予定は、患者名が入っていても除外される（強い除外）。

// 人の名前ではない単語（弱い除外）
//   患者を特定できなかった予定について、これらの単語・時刻・記号を取り除き、
//   残りに「人の名前らしい並び」（漢字2文字以上／漢字1文字＋かな2文字以上）が無ければ除外する。
//   名前が残る予定（例:「車両点検 山田」）は要確認として残るので、新患を誤って消さない。
//   ※1文字の単語は名字を削ってしまうため登録しない
const NON_NAME_WORDS = [
  // 車両・業者・来客
  '訪問車', '往診車', '車両', '点検', '車検', '洗車', '給油', '納品', '業者', '来客', '来訪',
  '面談', '面接', '見学', '説明会', '契約', '支払い', '支払', '銀行', '税理士', '社労士',
  // 事務・院内作業
  '事務', '書類', '請求', 'レセプト', 'レセ', '算定', '会計', '集金', '報告書', '計画書',
  '同意書', '契約書', '提出', '役所', '市役所', '保健所', '片付け', '掃除', '清掃', '消毒',
  '滅菌', '発注', '在庫', '棚卸', '技工', '送迎', '配達', '郵便', '書類作成',
  // 予定枠・連絡
  '予約', '空き', '空枠', 'キャンセル', '未定', '調整', '保留', '連絡', '電話', '確認',
  'TEL', 'メール', 'メモ', 'テスト', 'TODO', 'test', 'OFF',
  // 休み・時間帯
  '昼休み', '休憩', '昼食', 'ランチ', '有給', '有休', '代休', '半休', '午前休', '午後休',
  '欠勤', '早退', '遅刻', '帰院', '出発', '戻り', '午前', '午後', 'AM', 'PM',
  // 行事・会議
  '誕生日', '飲み会', '忘年会', '新年会', '歓迎会', '送別会', '懇親会', '講習', 'セミナー',
  '講演', '委員会', '担当者会議', 'カンファレンス', 'カンファ', '朝礼', '終礼', '申し送り',
  '往診', '訪問', '口腔ケア', 'ケア',
];

// 記録ドキュメントから治療内容を探すときの見出し（患者ごとに書き方が違うため、見つからなくても
// 「日付で区切った最新の回」→「最後の段落のまとまり」の順で探す。extractRecordFromParas 参照）
const CONTENT_HEADINGS = ['前回業務内容', '業務内容', '治療内容', '処置内容', '実施内容', '施術内容', '本日の処置', '今回の処置'];

// ▼ 動作モード
// 'label' = 記録ドキュメントの中身から短い単語（ケア/義歯 等）を作り、普通の文字で入力する（推奨）
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
const CONTENT_LABEL_AS_LINK  = false; // true にするとE列の単語をリンク（クリックで記録が開く）にする。既定は普通の文字
const MAX_DOCS_TO_SCAN       = 5;     // 中身が空の記録（当日分の白紙など）を飛ばして、新しい順に何件まで読むか
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
// 転記後、最後の予定行のすぐ下に「合計」行が来るよう、間の空行を削除する（書式は各行のまま）
//   0 = 空行を残さない / 1以上 = 手書き追記用にその行数だけ空行を残す
const BLANK_ROWS_ABOVE_FOOTER = 0;
const ROW_HEIGHT_DATA   = 34;      // 予定行の標準高さ(px)。既存の日付タブの予定行(25.5pt=34px)に合わせる

// ▼ 日付タブ・月まとめタブの自動作成
const TABS_AHEAD_MONTHS  = 3;      // メニュー／自動実行で「今月から何か月先まで」タブを用意するか
const CREATE_SUNDAY_TABS = false;  // 日曜のタブも作るか（既存は日曜なし。日曜に予定がある日だけは転記時に作成）
const TEMPLATE_FOOTER_ROW = 23;    // 見本にする日付タブの「合計」行（標準形＝予定行3〜22）
const SUMMARY_SAT_BG = '#e6f0ff';  // 月まとめ：土曜行の背景（見本タブから読めない場合の予備）
const SUMMARY_SUN_BG = '#ffe6e6';  // 月まとめ：日曜行の背景（同上）

// ▼ 設定タブ（スタッフが施設・カレンダーを追加するためのタブ）
const SETTINGS_FACILITY_SHEET = '設定_施設';
const SETTINGS_CALENDAR_SHEET = '設定_カレンダー';
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
    .addItem('記録ドキュメントの読み取り確認', 'diagnoseRecordDoc')
    .addSeparator()
    .addItem('設定タブを作成（初回のみ）', 'createSettingsSheets')
    .addItem('設定の確認（施設フォルダ・カレンダー）', 'checkSettings')
    .addItem('利用できるカレンダーの一覧', 'showCalendarList')
    .addSeparator()
    .addItem('日付タブを先まで作成', 'menuEnsureTabsAhead')
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
  // 先のタブを用意（転記の時間を残すため2分で打ち切り、残りは翌日以降に続きを作る）
  try { ensureTabsAhead(false, 2 * 60 * 1000); } catch (e) { Logger.log(`タブ自動作成エラー: ${e.message}`); }
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
  const summary = { written: 0, review: 0, errors: 0, excluded: 0, targetDate: fmtDate(targetDate) };
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
    if (!sheet) {
      // タブが無い → その月のタブ（まとめ＋月〜土）を自動作成。日曜は予定がある場合だけ作る
      sheet = ensureDayTab(ss, targetDate, allEvents.length > 0);
      if (sheet) Logger.log(`日付タブを自動作成しました: 「${sheet.getName()}」`);
    }
    if (!sheet) throw new Error(`当日のシートが見つかりません（日曜で予定なし、または見本タブなし）。探した名前: ${candidates.map(n => `「${n}」`).join(' / ')}`);
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
    Logger.log('【中断】患者マスタが空です。「設定_施設」タブ（またはROOT_FOLDER_IDS）・アクセス権を確認してください。');
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
        summary.excluded++;
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
        if (CONTENT_MODE === 'link') {
          const doc = getLatestDoc(p.folderId);
          if (doc) contentCell = `=HYPERLINK("${doc.url}","${LINK_LABEL}")`;
          else     biko = '記録ファイル未検出';
        } else { // 'label'（短い単語・既定）/ 'text'（文章そのまま）
          // 中身が空の記録（当日分の白紙など）は飛ばし、記載のある一番新しい記録を使う
          const rec = getLatestRecordContent(p.folderId, targetDate);
          if (!rec)          { contentCell = 'カルテなし'; biko = '記録ファイル未検出'; }
          else if (!rec.text) { contentCell = '記載なし'; }
          else {
            const shown = CONTENT_MODE === 'label' ? makeContentLabel(rec.text) : rec.text;
            contentCell = (CONTENT_MODE === 'label' && CONTENT_LABEL_AS_LINK)
              ? `=HYPERLINK("${rec.url}","${shown.replace(/"/g, '""')}")`
              : shown;
          }
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
    // 合計行を最後の予定行のすぐ下へ詰め、合計の式を予定行の範囲に合わせる
    try { compactToFooter(sheet); } catch (e) { Logger.log(`合計行の位置調整警告: ${e.message}`); }
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
    `重複スキップ: ${skipped}件\n` +
    `患者以外として除外: ${summary.excluded}件（内容は実行ログ）`);
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
  // 予定行が全部消えると合計式の範囲がなくなり #REF! になるため、
  // 予定行が1行も残らない場合は先頭の1行だけ「中身を消して残す」（書式・罫線はそのまま）
  const footer = findFooterRow(sheet);
  let keepRow = 0;
  if (footer > DATA_START_ROW && targetRows.length > 0) {
    const inRegion = targetRows.filter(r => r < footer).length;
    if (inRegion >= footer - DATA_START_ROW) keepRow = targetRows[0];
  }
  // 下から削除（行番号のズレを防ぐ／数式範囲は自動調整）。行メタデータも行と一緒に消える
  for (let i = targetRows.length - 1; i >= 0; i--) {
    const r = targetRows[i];
    if (r === keepRow) {
      sheet.getRange(r, 1, 1, TOTAL_COLS).clearContent().clearNote();
      sheet.getRange(`${r}:${r}`).getDeveloperMetadata()
        .forEach(md => { if (md.getKey() === AUTO_META_KEY) md.remove(); });
    } else {
      sheet.deleteRow(r);
    }
  }
  return targetRows.length;
}

// 最後の予定行と「合計」行の間の空行を削除し、合計行を最後の予定行のすぐ下に詰める
//   ・削除するのは「最後に記入のある行」より下の、A〜T列が完全に空の行だけ（手入力行は消さない）
//   ・予定行は最低1行残す（合計式の範囲を保つため）
//   ・行を削除するだけなので、残る行・合計行・AM/PM行の色や罫線は変わらない
function compactToFooter(sheet) {
  const footer = findFooterRow(sheet);
  if (!footer || footer <= DATA_START_ROW) return;
  const vals = sheet.getRange(DATA_START_ROW, 1, footer - DATA_START_ROW, TOTAL_COLS).getValues();
  let lastUsed = DATA_START_ROW - 1;
  vals.forEach((r, i) => { if (r.some(v => v !== '' && v !== null)) lastUsed = DATA_START_ROW + i; });
  const keepTo = Math.max(lastUsed + BLANK_ROWS_ABOVE_FOOTER, DATA_START_ROW);
  const delCount = (footer - 1) - keepTo;
  if (delCount > 0) {
    sheet.deleteRows(keepTo + 1, delCount);
    Logger.log(`合計行の上の空行を${delCount}行削除しました`);
  }
  fixFooterSums(sheet);
}

// 合計行の =SUM(…) を「3行目〜合計行の1つ上」に書き直す（行の挿入・削除で範囲がずれても正しく保つ）
//   単純な =SUM(…) の式が入っているセルだけを1つずつ書き換え、「合計」の文字や書式には触れない
function fixFooterSums(sheet) {
  const footer = findFooterRow(sheet);
  if (!footer || footer - 1 < DATA_START_ROW) return;
  const formulas = sheet.getRange(footer, 1, 1, TOTAL_COLS).getFormulas()[0];
  formulas.forEach((f, i) => {
    if (!/^=SUM\([^()]*\)$/i.test(f)) return;
    const L  = String.fromCharCode(65 + i);
    const nf = `=SUM(${L}${DATA_START_ROW}:${L}${footer - 1})`;
    if (f.replace(/\s/g, '').toUpperCase() !== nf.toUpperCase()) sheet.getRange(footer, i + 1).setFormula(nf);
  });
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
      //   見本は必ず既存の予定行にする（挿入したばかりの行・合計行を見本にすると書式が崩れる）
      //   ・合計行の直前に挿入した場合 → 挿入位置の1つ上の予定行
      //   ・予定行の途中に挿入した場合 → 挿入前に insertAt にあった予定行（挿入後は insertAt+need）
      try {
        const srcRow = (insertAt >= footer) ? Math.max(insertAt - 1, DATA_START_ROW) : insertAt + need; // 書式の見本行
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

  getRootEntries().forEach(entry => scanOneRoot(entry, master, facSet));

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
  return getRootEntries()
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

  for (const pair of getPairCalendars()) {
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
  const rec = getLatestRecordContent(folderId);
  return rec ? rec.text : null;
}

// 患者フォルダ内のGoogleドキュメントを新しい順（最終更新日時）に最大 MAX_DOCS_TO_SCAN 件読み、
// 治療内容の記載がある最初のものを返す。
//   → 当日分の白紙の記録が一番新しくても、前回の記載を拾える
// @return { text, url }（記載がどれにも無ければ text='' で一番新しい記録のURL）／ 記録なしは null
function getLatestRecordContent(folderId, targetDate) {
  const docs = withRetry(() => {
    const files = DriveApp.getFolderById(folderId).getFilesByType(MimeType.GOOGLE_DOCS);
    const list = [];
    while (files.hasNext()) {
      const f = files.next();
      list.push({ id: f.getId(), url: f.getUrl(), t: f.getLastUpdated().getTime() });
    }
    return list;
  }, 'listDocs');
  if (docs.length === 0) return null;
  docs.sort((a, b) => b.t - a.t);
  for (const d of docs.slice(0, MAX_DOCS_TO_SCAN)) {
    const text = extractBusinessContent(d.id, targetDate);
    if (text) return { text, url: d.url };
  }
  return { text: '', url: docs[0].url };
}

// 記録ドキュメントから「前回の治療内容」を取り出す（見つからなければ ''）
//   targetDate: 転記の対象日（この日より前の記録を「前回」とみなす）
function extractBusinessContent(docId, targetDate) {
  const paragraphs = withRetry(() => DocumentApp.openById(docId).getBody().getParagraphs(), 'openDoc');
  const paras = paragraphs.map(p => ({
    text: p.getText().trim(),
    isHeading: p.getHeading() !== DocumentApp.ParagraphHeading.NORMAL,
  }));
  return extractRecordFromParas(paras, targetDate || new Date());
}

// 段落の並び → 前回の治療内容（患者ごとに記録の書き方が違っても拾えるよう、3段階で探す）
//   1) 日付で区切る：行頭の日付（R8.9.18 / 令和8年9月18日 / 2026/9/18 / 9/18 / 9月18日）で
//      訪問ごとに区切り、対象日より前で一番新しい回の本文を使う（対象日より前が無ければ一番新しい回）
//   2) 見出しで探す：CONTENT_HEADINGS を含む行の下（複数あれば一番最後＝最新の回）
//   3) 最後のまとまり：空行で区切った最後の段落のまとまり
//   いずれも「日付：」「氏名：」のような項目名だけの行しか無いもの（白紙の記録）は採用しない
function extractRecordFromParas(paras, targetDate) {
  const ref = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  // 1) 日付で区切る
  const entries = [];
  let cur = null;
  paras.forEach(p => {
    const d = parseLeadingDate(p.text, ref);
    if (d) { cur = { date: d.date, lines: d.rest ? [d.rest] : [] }; entries.push(cur); }
    else if (cur && p.text) cur.lines.push(p.text);
  });
  const valid = entries.filter(e => hasRecordText(e.lines.join('\n')));
  if (valid.length > 0) {
    const before = valid.filter(e => e.date < ref);
    const pool = before.length ? before : valid;
    let best = pool[0];
    pool.forEach(e => { if (e.date >= best.date) best = e; }); // 同じ日付なら後ろに書かれた方
    return cleanRecordLines(best.lines);
  }

  // 2) 見出しで探す（一番最後に見つかったもの）
  let found = '';
  for (let i = 0; i < paras.length; i++) {
    const kw = CONTENT_HEADINGS.find(k => paras[i].text.includes(k));
    if (!kw) continue;
    const lines = [];
    const rest = paras[i].text.slice(paras[i].text.indexOf(kw) + kw.length).replace(/^[\s:：】\]）)]+/, '').trim();
    if (rest) lines.push(rest);
    for (let j = i + 1; j < paras.length; j++) {
      const t = paras[j].text;
      if (!t) { if (lines.length) break; else continue; }
      if (paras[j].isHeading || CONTENT_HEADINGS.some(k => t.includes(k))) break;
      lines.push(t);
    }
    if (hasRecordText(lines.join('\n'))) found = cleanRecordLines(lines);
  }
  if (found) return found;

  // 3) 最後のまとまり（空行区切り）
  const blocks = [];
  let blk = [];
  paras.forEach(p => {
    if (p.text) blk.push(p.text);
    else if (blk.length) { blocks.push(blk); blk = []; }
  });
  if (blk.length) blocks.push(blk);
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (hasRecordText(blocks[i].join('\n'))) return cleanRecordLines(blocks[i]);
  }
  return '';
}

// 行頭の日付を読む。{date, rest(日付の後ろの文字)} または null
//   月/日だけの書き方は、基準日より後になる場合は前年とみなす
function parseLeadingDate(line, ref) {
  const t = toHalfWidth(line).replace(/^[\s【\[（(〈<●■◆◇○・\-]+/, '');
  let y, m, d, len;
  let x = t.match(/^(?:令和|R)\s*(\d{1,2})\s*[年.\/\-]\s*(\d{1,2})\s*[月.\/\-]\s*(\d{1,2})\s*日?/i);
  if (x) { y = 2018 + Number(x[1]); m = +x[2]; d = +x[3]; len = x[0].length; }
  if (!x) {
    x = t.match(/^(20\d{2})\s*[年.\/\-]\s*(\d{1,2})\s*[月.\/\-]\s*(\d{1,2})\s*日?/);
    if (x) { y = +x[1]; m = +x[2]; d = +x[3]; len = x[0].length; }
  }
  if (!x) {
    x = t.match(/^(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*日?(?!\d)/);
    if (x) {
      m = +x[1]; d = +x[2]; len = x[0].length; y = ref.getFullYear();
      if (new Date(y, m - 1, d) > new Date(ref.getTime() + 86400000)) y--;
    }
  }
  if (!x || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const rest = t.slice(len).replace(/^[\s)）】\]>〉:：\-]+/, '').replace(/^[(（][月火水木金土日][)）]\s*/, '').trim();
  return { date: new Date(y, m - 1, d), rest };
}

// 項目名だけの行（「処置：」「氏名：」等）を除き、中身のある行だけを返す
//   「次回予定」「次回：」など次回の予定から後ろは、今回の治療内容ではないので含めない
function cleanRecordLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    if (/^[\s【\[(（]*次回/.test(l)) break;
    if (/^[^：:]{1,12}[：:]\s*$/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n');
}

// 治療内容として意味のある文字（かな・漢字・英字が2文字以上続く）があるか
function hasRecordText(text) {
  return /[A-Za-z぀-ヿ㐀-鿿]{2,}/.test(cleanRecordLines(String(text || '').split('\n')));
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

// 人の名前らしい並びが無い予定を「患者ではない」とみなす（患者を特定できなかった予定のみに使う）
//   1) 3桁以上の番号（カルテ番号の可能性）があれば患者扱い（除外しない）
//   2) 時刻・NON_NAME_WORDS・記号・短い数字を取り除く
//   3) 残りに「漢字2文字以上」または「漢字1文字＋かな2文字以上」（例: 林たけ）が無ければ除外
//   例: PCM / カンファレンス / 車両点検 / 昼休み 12:00 / 担当者会議 → 除外
//       車両点検 山田 / 林たけ / 7630 → 残す（要確認）
function looksNonPatient(title) {
  let t = toHalfWidth(title);
  if (/\d{3,}/.test(t)) return false;
  t = t.replace(/\d{1,2}[:：]\d{2}\s*(頃|ごろ|前後|くらい|~|〜|-)?/g, ' ');
  NON_NAME_WORDS
    .map(w => toHalfWidth(w))
    .sort((a, b) => b.length - a.length) // 長い単語から消す（「担当者会議」を「会議」より先に）
    .forEach(w => {
      t = /^[A-Za-z]+$/.test(w)
        ? t.replace(new RegExp(`(^|[^A-Za-z])${w}(?![A-Za-z])`, 'gi'), '$1 ')
        : t.split(w).join(' ');
    });
  const KANJI = '\u3400-\u9fff\uf900-\ufaff々';
  const KANA  = '\u3040-\u30ff';
  const nameLike = new RegExp(`[${KANJI}]{2,}|[${KANJI}][${KANA}]{2,}`);
  return !nameLike.test(t);
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
// 設定タブ（施設フォルダ・ペアカレンダー）
//   スタッフがスプレッドシート上で施設・カレンダーを追加／停止できるようにする。
//   設定タブが無い間は、コード内の ROOT_FOLDER_IDS / PAIR_CALENDARS を使う。
//
//   「設定_施設」     A:有効(✓) B:施設名 C:フォルダのURLまたはID D:メモ E:確認結果
//     ・施設名は予定表のB列に出る名前。空欄なら従来の自動判別（フォルダ名から判断）
//   「設定_カレンダー」A:有効(✓) B:担当DR C:担当DH D:カレンダーID E:メモ F:確認結果
//   ※患者は施設フォルダの中の「番号_氏名」フォルダから自動で読み込むので、設定は不要
// ============================================================
let _rootEntriesMemo = null;
let _pairCalendarsMemo = null;

function getSettingsSheet(name) {
  try { return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name); }
  catch (e) { Logger.log(`設定タブ読込エラー(${name}): ${e.message}`); return null; }
}

// チェックボックスの ✓（または ○ / TRUE / 有効 / 1）なら有効
function isEnabledCell(v) {
  if (v === true) return true;
  return /^(true|○|◯|✓|✔|有効|1)$/i.test(String(v == null ? '' : v).trim());
}

// フォルダのURL・IDのどちらを貼られてもIDを取り出す
function extractDriveId(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}

// 施設フォルダの一覧（設定_施設 タブ優先。タブが無ければ ROOT_FOLDER_IDS）
function getRootEntries() {
  if (_rootEntriesMemo) return _rootEntriesMemo;
  const sh = getSettingsSheet(SETTINGS_FACILITY_SHEET);
  if (!sh) return (_rootEntriesMemo = ROOT_FOLDER_IDS);
  const list = [];
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      if (!isEnabledCell(r[0])) return;
      const id = extractDriveId(r[2]);
      if (!id) return;
      const name = String(r[1] == null ? '' : r[1]).trim();
      list.push(name ? { id, name } : id);
    });
  }
  return (_rootEntriesMemo = list);
}

// ペアカレンダーの一覧（設定_カレンダー タブ優先。タブが無ければ PAIR_CALENDARS）
function getPairCalendars() {
  if (_pairCalendarsMemo) return _pairCalendarsMemo;
  const sh = getSettingsSheet(SETTINGS_CALENDAR_SHEET);
  if (!sh) return (_pairCalendarsMemo = PAIR_CALENDARS);
  const list = [];
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(r => {
      if (!isEnabledCell(r[0])) return;
      const id = String(r[3] == null ? '' : r[3]).trim();
      if (!id) return;
      list.push({ id, dr: String(r[1] || '').trim(), dh: String(r[2] || '').trim() });
    });
  }
  return (_pairCalendarsMemo = list);
}

// 【メニュー】設定タブを作成し、現在のコード内の設定を書き出す（既にあれば何もしない）
function createSettingsSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const made = [];
  try {
    if (!ss.getSheetByName(SETTINGS_FACILITY_SHEET)) {
      const rows = ROOT_FOLDER_IDS.map(e => (typeof e === 'string')
        ? [true, '', e, '施設名空欄＝フォルダ名から自動判別', '']
        : [true, e.name || '', e.id, '', '']);
      buildSettingsSheet(ss, SETTINGS_FACILITY_SHEET,
        ['有効', '施設名（予定表B列）', 'フォルダのURLまたはID', 'メモ', '確認結果'],
        [8, 22, 48, 30, 40], rows);
      made.push(SETTINGS_FACILITY_SHEET);
    }
    if (!ss.getSheetByName(SETTINGS_CALENDAR_SHEET)) {
      const rows = PAIR_CALENDARS.map(p => [true, p.dr, p.dh, p.id, '', '']);
      buildSettingsSheet(ss, SETTINGS_CALENDAR_SHEET,
        ['有効', '担当DR', '担当DH', 'カレンダーID', 'メモ', '確認結果'],
        [8, 12, 12, 60, 24, 32], rows);
      made.push(SETTINGS_CALENDAR_SHEET);
    }
  } catch (e) {
    finishPopup(true, `設定タブを作成できませんでした: ${e.message}`);
    return;
  }
  finishPopup(true, made.length
    ? `作成しました: ${made.join(' / ')}\n\n` +
      '・施設やカレンダーを増やすときは、最後の行の下に1行追加し「有効」に✓を付けてください。\n' +
      '・使わなくなったものは行を消さず「有効」の✓を外すと停止できます。\n' +
      '・追加したら、メニュー「設定の確認」で ✓ が出るか確認してください。'
    : '設定タブは既にあります。');
}

function buildSettingsSheet(ss, name, headers, widthsChars, rows) {
  const ROWS = 200;
  const sh = ss.insertSheet(name, ss.getSheets().length);
  // セル数上限対策：必要な大きさ（200行×見出し列数）に縮める
  if (sh.getMaxRows() > ROWS) sh.deleteRows(ROWS + 1, sh.getMaxRows() - ROWS);
  if (sh.getMaxColumns() > headers.length) sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#d9e1f2');
  sh.setFrozenRows(1);
  widthsChars.forEach((w, i) => sh.setColumnWidth(i + 1, w * 8));
  sh.getRange(2, 1, ROWS - 1, 1).insertCheckboxes();
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return sh;
}

// 【メニュー】設定の確認：各行のフォルダ・カレンダーが開けるかを「確認結果」列に書き込む
function checkSettings() {
  _rootEntriesMemo = null; _pairCalendarsMemo = null;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const msgs = [];

  const fs = ss.getSheetByName(SETTINGS_FACILITY_SHEET);
  if (fs && fs.getLastRow() >= 2) {
    const vals = fs.getRange(2, 1, fs.getLastRow() - 1, 3).getValues();
    let ok = 0, ng = 0;
    const out = vals.map(r => {
      if (!r[2]) return [''];
      if (!isEnabledCell(r[0])) return ['（停止中）'];
      const id = extractDriveId(r[2]);
      if (!id) { ng++; return ['✗ URL/IDの形式が正しくありません']; }
      try {
        const f = DriveApp.getFolderById(id);
        let n = 0; const it = f.getFolders(); while (it.hasNext()) { it.next(); n++; }
        ok++;
        return [`✓ 「${f.getName()}」 直下フォルダ${n}件`];
      } catch (e) { ng++; return [`✗ 開けません（共有・IDを確認）`]; }
    });
    fs.getRange(2, 5, out.length, 1).setValues(out);
    msgs.push(`施設フォルダ: OK ${ok}件 / NG ${ng}件`);
  } else {
    msgs.push(`「${SETTINGS_FACILITY_SHEET}」タブがありません（コード内の設定を使用中）`);
  }

  const cs = ss.getSheetByName(SETTINGS_CALENDAR_SHEET);
  if (cs && cs.getLastRow() >= 2) {
    const vals = cs.getRange(2, 1, cs.getLastRow() - 1, 4).getValues();
    let ok = 0, ng = 0;
    const out = vals.map(r => {
      const id = String(r[3] || '').trim();
      if (!id) return [''];
      if (!isEnabledCell(r[0])) return ['（停止中）'];
      try {
        const cal = CalendarApp.getCalendarById(id);
        if (!cal) { ng++; return ['✗ 見つかりません（共有・IDを確認）']; }
        ok++;
        return [`✓ 「${cal.getName()}」`];
      } catch (e) { ng++; return ['✗ 開けません（共有・IDを確認）']; }
    });
    cs.getRange(2, 6, out.length, 1).setValues(out);
    msgs.push(`カレンダー: OK ${ok}件 / NG ${ng}件`);
  } else {
    msgs.push(`「${SETTINGS_CALENDAR_SHEET}」タブがありません（コード内の設定を使用中）`);
  }
  finishPopup(true, msgs.join('\n') + '\n\n詳細は各設定タブの「確認結果」列を見てください。');
}

// 【メニュー】実行アカウントで見られるカレンダーの名前とIDを表示（設定_カレンダー への追加用）
function showCalendarList() {
  const lines = CalendarApp.getAllCalendars().map(c => `${c.getName()}\n  ${c.getId()}`);
  Logger.log(lines.join('\n'));
  finishPopup(true, lines.length
    ? '「カレンダーID」を 設定_カレンダー のD列に貼り付けてください。\n\n' + lines.join('\n')
    : '見られるカレンダーがありません。');
}


// ============================================================
// 日付タブ・月まとめタブの自動作成
//   既存タブを見本に「複製」して作るため、書式・列幅・合計式・印刷設定は既存と同じになる。
//   ・日付タブ：最新の標準形タブ（合計行＝23行目）を複製 → 1行目の日付を書き換え、予定行を空にする
//   ・月まとめ：最新の月まとめタブを複製 → タイトル・日付・曜日・行数・合計式・土日の色を書き換え
//   ・並び順は既存と同じ（その月の まとめ → 1日 → 2日 …）
//   ・作るのは月〜土（祝日も作る）。日曜は CREATE_SUNDAY_TABS=true の場合のみ
// ============================================================
// タブ名 → 並び順キー（まとめは日=0）。対象外のタブは null
function sheetDateKey(name) {
  const m = String(name).match(/^R(\d+)_(\d{1,2})月(?:(\d{1,2})日[(（].[)）]|まとめ)$/);
  if (!m) return null;
  return (Number(m[1]) + 2018) * 10000 + Number(m[2]) * 100 + (m[3] ? Number(m[3]) : 0);
}

function summarySheetName(y, m) { return `R${y - 2018}_${m}月まとめ`; }

function findSheetByDate(ss, date) {
  for (const name of buildDateSheetNames(date)) {
    const sh = ss.getSheetByName(name);
    if (sh) return sh;
  }
  return null;
}

// 見本の日付タブ（後ろから探して、合計行が標準位置にあるもの）
function findTemplateDayTab(ss) {
  const sheets = ss.getSheets();
  let checked = 0;
  for (let i = sheets.length - 1; i >= 0 && checked < 80; i--) {
    const sh = sheets[i];
    if (!DAY_TAB_RE.test(sh.getName())) continue;
    checked++;
    if (sh.getMaxRows() >= TEMPLATE_FOOTER_ROW &&
        String(sh.getRange(TEMPLATE_FOOTER_ROW, 1).getValue()).replace(/\s|　/g, '') === '合計') return sh;
  }
  return null;
}

// 見本の月まとめタブ（一番後ろのもの）
function findTemplateSummaryTab(ss) {
  const sheets = ss.getSheets();
  for (let i = sheets.length - 1; i >= 0; i--) {
    if (/^R\d+_\d{1,2}月まとめ$/.test(sheets[i].getName())) return sheets[i];
  }
  return null;
}

// 見本タブを複製し、日付順の正しい位置に置く
function copyTabInOrder(ss, template, name) {
  const key = sheetDateKey(name);
  const sheets = ss.getSheets();
  let pos = sheets.length; // 挿入位置（0基点＝この数のタブの後ろ）
  for (let i = sheets.length - 1; i >= 0; i--) {
    const k = sheetDateKey(sheets[i].getName());
    if (k !== null && k < key) { pos = i + 1; break; }
    if (k !== null && k > key) pos = i;
  }
  const active = ss.getActiveSheet();
  const sh = template.copyTo(ss).setName(name);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(pos + 1);
  if (active) ss.setActiveSheet(active);
  // 見本に付いていた自動生成行の目印（行メタデータ）は引き継がない
  sh.createDeveloperMetadataFinder().withKey(AUTO_META_KEY).find().forEach(md => md.remove());
  return sh;
}

// 日付タブを1枚作る
function createDayTab(ss, date) {
  const tpl = findTemplateDayTab(ss);
  if (!tpl) { Logger.log('見本にできる日付タブ（合計行が23行目）が見つかりません'); return null; }
  const name = buildDateSheetNames(date)[0];
  const sh = copyTabInOrder(ss, tpl, name);

  // 1行目：「令和10年　3月　31日　（金）　　DH：…」の日付部分だけ書き換える
  const reiwa = date.getFullYear() - 2018;
  const w = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  const prefix = `令和${reiwa}年　${date.getMonth() + 1}月　${date.getDate()}日　（${w}）`;
  const title = String(sh.getRange(1, 1).getValue());
  const re = /^令和\d+年[\s　]*\d+月[\s　]*\d+日[\s　]*[（(].[）)]/;
  sh.getRange(1, 1).setValue(re.test(title) ? title.replace(re, prefix) : prefix);

  // 予定行（3行目〜合計行の1つ前）を空にする。見出し・合計行・AM/PM行はそのまま
  const footer = findFooterRow(sh) || TEMPLATE_FOOTER_ROW;
  if (footer > DATA_START_ROW) {
    sh.getRange(DATA_START_ROW, 1, footer - DATA_START_ROW, TOTAL_COLS).clearContent().clearNote();
  }
  trimSheetGrid(sh, TOTAL_COLS);
  return sh;
}

// 月まとめタブを1枚作る
function createSummaryTab(ss, y, m) {
  const tpl = findTemplateSummaryTab(ss);
  if (!tpl) { Logger.log('見本にできる月まとめタブが見つかりません'); return null; }
  const sh = copyTabInOrder(ss, tpl, summarySheetName(y, m));
  const cols = Math.max(sh.getLastColumn(), 9);

  // タイトル「令和10年3月　訪問日予定　月間まとめ」
  const title = String(sh.getRange(1, 1).getValue());
  const re = /^令和\d+年\d+月/;
  sh.getRange(1, 1).setValue(re.test(title) ? title.replace(re, `令和${y - 2018}年${m}月`)
                                            : `令和${y - 2018}年${m}月　訪問日予定　月間まとめ`);

  // 見本の合計行・土日の色を読む
  const last = sh.getLastRow();
  const colA = sh.getRange(1, 1, last, 2).getValues();
  let totalRow = 0;
  for (let r = DATA_START_ROW; r <= last; r++) {
    if (String(colA[r - 1][0]).replace(/\s|　/g, '') === '合計') { totalRow = r; break; }
  }
  if (!totalRow) { Logger.log(`月まとめの合計行が見つかりません: ${sh.getName()}`); return sh; }
  let satBg = SUMMARY_SAT_BG, sunBg = SUMMARY_SUN_BG, dayBg = null;
  for (let r = DATA_START_ROW; r < totalRow; r++) {
    const wd = colA[r - 1][1];
    const bg = sh.getRange(r, 1).getBackground();
    if (wd === '土') satBg = bg;
    else if (wd === '日') sunBg = bg;
    else if (dayBg === null) dayBg = bg;
  }
  if (dayBg === null || dayBg === '#ffffff') dayBg = null; // 平日は色なし

  // 行数をその月の日数に合わせる
  const tplDays = totalRow - DATA_START_ROW;
  const n = new Date(y, m, 0).getDate();
  if (n > tplDays) {
    sh.insertRowsBefore(totalRow, n - tplDays);
    sh.getRange(DATA_START_ROW, 1, 1, cols)
      .copyTo(sh.getRange(totalRow, 1, n - tplDays, cols), { formatOnly: true });
    sh.setRowHeights(totalRow, n - tplDays, sh.getRowHeight(DATA_START_ROW));
  } else if (n < tplDays) {
    sh.deleteRows(DATA_START_ROW + n, tplDays - n);
  }
  const newTotal = DATA_START_ROW + n;

  // 日付（文字の「3/1」）と曜日、土日の色
  const ab = [], bgs = [];
  for (let d = 1; d <= n; d++) {
    const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
    ab.push([`'${m}/${d}`, w]);
    const bg = w === '土' ? satBg : (w === '日' ? sunBg : dayBg);
    bgs.push(new Array(cols).fill(bg));
  }
  sh.getRange(DATA_START_ROW, 1, n, 2).setValues(ab);
  sh.getRange(DATA_START_ROW, 3, n, cols - 2).clearContent().clearNote();
  sh.getRange(DATA_START_ROW, 1, n, cols).setBackgrounds(bgs);

  // 合計行の式（C〜H列）を日数に合わせて書き直す
  const lastData = newTotal - 1;
  const sums = [];
  for (let c = 3; c <= Math.min(8, cols); c++) {
    const L = String.fromCharCode(64 + c);
    sums.push(`=SUM(${L}${DATA_START_ROW}:${L}${lastData})`);
  }
  sh.getRange(newTotal, 3, 1, sums.length).setFormulas([sums]);
  trimSheetGrid(sh, cols);
  return sh;
}

// 使っていない行・列を削る（スプレッドシートのセル数上限1,000万セル対策）
function trimSheetGrid(sh, minCols) {
  try {
    const lr = Math.max(sh.getLastRow(), 1);
    const lc = Math.max(sh.getLastColumn(), minCols || 1);
    if (sh.getMaxRows() > lr) sh.deleteRows(lr + 1, sh.getMaxRows() - lr);
    if (sh.getMaxColumns() > lc) sh.deleteColumns(lc + 1, sh.getMaxColumns() - lc);
  } catch (e) { Logger.log(`行列の削減警告 「${sh.getName()}」: ${e.message}`); }
}

// その月の足りないタブ（まとめ＋月〜土）を作る
// @return { created: 作成数, finished: 時間内に全部作れたか }
function ensureMonthTabs(ss, y, m, deadline) {
  let created = 0;
  if (!ss.getSheetByName(summarySheetName(y, m))) {
    if (createSummaryTab(ss, y, m)) created++;
  }
  const n = new Date(y, m, 0).getDate();
  for (let d = 1; d <= n; d++) {
    if (deadline && Date.now() > deadline) return { created, finished: false };
    const date = new Date(y, m - 1, d);
    if (date.getDay() === 0 && !CREATE_SUNDAY_TABS) continue;
    if (!findSheetByDate(ss, date)) {
      if (createDayTab(ss, date)) created++;
    }
  }
  return { created, finished: true };
}

// 転記時：対象日のタブが無ければ、その月のタブを作ってから返す（日曜は予定がある場合だけ作る）
function ensureDayTab(ss, date, allowSunday) {
  ensureMonthTabs(ss, date.getFullYear(), date.getMonth() + 1, Date.now() + LAYOUT_TIME_BUDGET_MS);
  let sh = findSheetByDate(ss, date);
  if (!sh && date.getDay() === 0 && allowSunday) sh = createDayTab(ss, date);
  return sh;
}

// 今月から TABS_AHEAD_MONTHS か月先までのタブを用意する（6分制限に備え時間で区切る）
function ensureTabsAhead(showPopup, budgetMs) {
  const t0 = Date.now();
  const deadline = t0 + (budgetMs || LAYOUT_TIME_BUDGET_MS);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const today = new Date();
  let created = 0, finished = true;
  for (let k = 0; k <= TABS_AHEAD_MONTHS; k++) {
    const d = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const r = ensureMonthTabs(ss, d.getFullYear(), d.getMonth() + 1, deadline);
    created += r.created;
    if (!r.finished) { finished = false; break; }
  }
  const last = new Date(today.getFullYear(), today.getMonth() + TABS_AHEAD_MONTHS, 1);
  const msg = `日付タブの作成: ${created}枚（令和${last.getFullYear() - 2018}年${last.getMonth() + 1}月まで）` +
    (finished ? '' : '\nまだ残りがあります。もう一度実行してください。');
  Logger.log(msg);
  finishPopup(showPopup, msg);
  return created;
}

function menuEnsureTabsAhead() { ensureTabsAhead(true); }


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
  return toHalfWidth(String(str == null ? '' : str).normalize('NFKC')) // 互換漢字（神 等）・半角カナも統一
    .replace(/[\s\S]/gu, ch => KANJI_VARIANTS[ch] || ch)                // 旧字体・異体字をそろえる
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
  getRootEntries().forEach(entry => {
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
// 【診断用・メニュー】記録ドキュメントの読み取り確認
//   カルテ番号を入力すると、その患者の記録ドキュメント（新しい順）と、
//   一番新しい記録の段落構成（見出しの種類・先頭30文字）を実行ログに出す。
//   E列が「記載なし」になる原因（見出し名の違い・表の中に書いている等）を調べるために使う
// ============================================================
function diagnoseRecordDoc() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('記録ドキュメントを確認する患者のカルテ番号を入力してください', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const no = toHalfWidth(res.getResponseText()).trim();
  const master = buildPatientMaster(SpreadsheetApp.openById(SPREADSHEET_ID));
  const recs = master.byNumber.get(no) || [];
  if (recs.length === 0) { ui.alert(`カルテ番号 ${no} の患者フォルダが見つかりません`); return; }

  recs.forEach(rec => {
    Logger.log(`=== [${rec.facility}] №${rec.patientNo} ${rec.patientName} ===`);
    const files = DriveApp.getFolderById(rec.folderId).getFilesByType(MimeType.GOOGLE_DOCS);
    const docs = [];
    while (files.hasNext()) { const f = files.next(); docs.push(f); }
    docs.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());
    Logger.log(`記録ドキュメント ${docs.length}件（新しい順）: ` +
      docs.slice(0, 10).map(f => `「${f.getName()}」${fmtDate(f.getLastUpdated())}`).join(' / '));
    docs.slice(0, 2).forEach(f => {
      Logger.log(`--- 「${f.getName()}」の段落（先頭80件） / 抽出結果: "${extractBusinessContent(f.getId()).slice(0, 60)}"`);
      const paras = DocumentApp.openById(f.getId()).getBody().getParagraphs();
      paras.slice(0, 80).forEach((p, i) => {
        const t = p.getText().trim();
        if (!t) return;
        const inTable = p.getParent() && p.getParent().getType() === DocumentApp.ElementType.TABLE_CELL;
        Logger.log(`${i}: [${p.getHeading()}${inTable ? '/表' : ''}] ${t.slice(0, 30)}`);
      });
    });
  });
  ui.alert('実行ログに記録ドキュメントの構成を出力しました。\n' +
    'Apps Script の「実行数」から今回の実行を開き、ログを確認してください。');
}


// ============================================================
// 【導入用】追加した施設フォルダIDが実際に開けるか一括確認
//   アクセス権・IDの打ち間違い・階層構造をまとめて点検する
// ============================================================
function testFacilityFolders() {
  Logger.log('=== 施設フォルダ 一括確認 開始 ===');
  let ok = 0, ng = 0;
  getRootEntries().forEach(entry => {
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
