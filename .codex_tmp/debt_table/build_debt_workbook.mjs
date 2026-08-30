import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const rootDir = path.resolve("C:/Users/10228/OneDrive/桌面/项目/yingbox");
const outputDir = path.join(rootDir, "outputs", "debt_table_20260614");
const outputPath = path.join(outputDir, "全部欠款整理表.xlsx");

const pendingBills = [
  ["全部待还账单", "2026-06-20", "2026年6月待还", 4530.11, "已出账", "2_421905.jpeg"],
  ["全部待还账单", "2026-07-20", "2026年7月待还", 4865.30, "", "2_421905.jpeg"],
  ["全部待还账单", "2026-08-20", "2026年8月待还", 4489.60, "", "2_421905.jpeg"],
  ["全部待还账单", "2026-09-20", "2026年9月待还", 1773.62, "", "2_421905.jpeg"],
  ["全部待还账单", "2026-10-20", "2026年10月待还", 1773.62, "", "2_421905.jpeg"],
  ["全部待还账单", "2026-11-20", "2026年11月待还", 1773.62, "", "2_421905.jpeg"],
  ["全部待还账单", "2026-12-20", "2026年12月待还", 1773.62, "", "1_421906.jpeg"],
  ["全部待还账单", "2027-01-20", "2027年1月待还", 1773.62, "", "1_421906.jpeg"],
  ["全部待还账单", "2027-02-20", "2027年2月待还", 1773.62, "", "1_421906.jpeg"],
  ["全部待还账单", "2027-03-20", "2027年3月待还", 1773.62, "", "1_421906.jpeg"],
  ["全部待还账单", "2027-04-20", "2027年4月待还", 1773.62, "", "1_421906.jpeg"],
  ["全部待还账单", "2027-05-20", "2027年5月待还", 1773.62, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-06-20", "2027年6月待还", 1160.89, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-07-20", "2027年7月待还", 1160.89, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-08-20", "2027年8月待还", 1160.89, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-09-20", "2027年9月待还", 1160.89, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-10-20", "2027年10月待还", 1160.89, "", "0_421907.jpeg"],
  ["全部待还账单", "2027-11-20", "2027年11月待还", 1160.89, "", "0_421907.jpeg / 5_421908.jpeg"],
  ["全部待还账单", "2027-12-20", "2027年12月待还", 1160.89, "", "0_421907.jpeg / 5_421908.jpeg"],
  ["全部待还账单", "2028-01-20", "2028年1月待还", 1160.89, "", "5_421908.jpeg"],
  ["全部待还账单", "2028-02-20", "2028年2月待还", 1160.89, "", "5_421908.jpeg"],
  ["全部待还账单", "2028-03-20", "2028年3月待还", 1160.89, "", "5_421908.jpeg"],
  ["全部待还账单", "2028-04-20", "2028年4月待还", 1160.89, "", "5_421908.jpeg"],
  ["全部待还账单", "2028-05-20", "2028年5月待还", 1160.89, "", "5_421908.jpeg"],
];

const loanPlan1063 = [
  ["借款还款计划", "2026-06-26", "第1期", 1063.88, "截图显示6期，每期1,063.88", "3_IMG_7326.png"],
  ["借款还款计划", "2026-07-26", "第2期", 1063.88, "截图柱状图显示每期1,063.88", "3_IMG_7326.png"],
  ["借款还款计划", "2026-08-26", "第3期", 1063.88, "截图柱状图显示每期1,063.88", "3_IMG_7326.png"],
  ["借款还款计划", "2026-09-26", "第4期", 1063.88, "截图柱状图显示每期1,063.88", "3_IMG_7326.png"],
  ["借款还款计划", "2026-10-26", "第5期", 1063.88, "截图柱状图显示每期1,063.88", "3_IMG_7326.png"],
  ["借款还款计划", "2026-11-26", "第6期", 1063.88, "截图柱状图显示每期1,063.88", "3_IMG_7326.png"],
];

const loanPlan18000 = [
  ["18,000借款详情", "2026-06-26", "第2期", 3232.24, "本金3,000.00 + 利息232.24", "6_IMG_7324.png / 7_IMG_7325.png"],
  ["18,000借款详情", "2026-07-26", "第3期", 3179.80, "本金3,000.00 + 利息179.80", "6_IMG_7324.png / 7_IMG_7325.png"],
  ["18,000借款详情", "2026-08-26", "第4期", 3139.35, "本金3,000.00 + 利息139.35", "6_IMG_7324.png / 7_IMG_7325.png"],
  ["18,000借款详情", "2026-09-26", "第5期", 3092.90, "本金3,000.00 + 利息92.90", "6_IMG_7324.png / 7_IMG_7325.png"],
  ["18,000借款详情", "2026-10-26", "第6期", 3044.95, "本金3,000.00 + 利息44.95", "6_IMG_7324.png / 7_IMG_7325.png"],
];

const manualDebts = [
  ["手写欠款", "每月5号", 5200.00, 4, "=C2*D2", "4_IMG_7327.png", "截图文字：5号 5200 余4"],
  ["手写欠款", "每月12号", 1200.00, 8, "=C3*D3", "4_IMG_7327.png", "截图文字：12号 1200 余8"],
  ["手写欠款", "每月14号", 1900.00, 7, "=C4*D4", "4_IMG_7327.png", "截图文字：14号 1900 余7"],
  ["手写欠款", "每月20号", 1800.00, 8, "=C5*D5", "4_IMG_7327.png", "截图文字：20号 1800 余8"],
  ["手写欠款", "每月23号", 1900.00, 10, "=C6*D6", "4_IMG_7327.png", "截图文字：23号 1900 余10"],
];

const sourceRows = [
  ["2_421905.jpeg", "全部待还账单总额43,778.27；2026年6-11月明细。"],
  ["1_421906.jpeg", "2026年12月；2027年1-6月明细。"],
  ["0_421907.jpeg", "2027年5-12月明细。"],
  ["5_421908.jpeg", "2027年11-12月；2028年1-5月明细。"],
  ["3_IMG_7326.png", "借款还款页：6月26日应还1,063.88；共6期；剩余本金6,182.71。"],
  ["6_IMG_7324.png", "18,000借款详情：当前显示15,000.00；2026.04.23借款18,000.00；第2-6期待还计划。"],
  ["7_IMG_7325.png", "同一18,000借款详情截图，显示第2-6期金额和本金/利息拆分。"],
  ["4_IMG_7327.png", "手写/截图文字：5号5200余4、12号1200余8、14号1900余7、20号1800余8、23号1900余10。"],
];

const manualPlanItems = [
  { day: 5, amount: 5200.00, count: 4, label: "5号 5200 余4" },
  { day: 12, amount: 1200.00, count: 8, label: "12号 1200 余8" },
  { day: 14, amount: 1900.00, count: 7, label: "14号 1900 余7" },
  { day: 20, amount: 1800.00, count: 8, label: "20号 1800 余8" },
  { day: 23, amount: 1900.00, count: 10, label: "23号 1900 余10" },
];

function toDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function makeManualInstallments() {
  const rows = [];
  for (const item of manualPlanItems) {
    for (let i = 0; i < item.count; i += 1) {
      const date = new Date(Date.UTC(2026, 5 + i, item.day));
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      rows.push([
        "手写欠款",
        `${yyyy}-${mm}-${dd}`,
        `${item.day}号 第${i + 1}/${item.count}期`,
        item.amount,
        `按截图“${item.label}”展开`,
        "4_IMG_7327.png",
      ]);
    }
  }
  return rows;
}

const manualInstallments = makeManualInstallments();

const allScheduleRows = [...pendingBills, ...loanPlan1063, ...loanPlan18000, ...manualInstallments]
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map((row) => [row[0], toDate(row[1]), row[2], row[3], row[4], row[5]]);

const workbook = Workbook.create();
const summary = workbook.worksheets.add("汇总");
const schedule = workbook.worksheets.add("逐月还款明细");
const manual = workbook.worksheets.add("手写欠款");
const sources = workbook.worksheets.add("附件摘录");

for (const sheet of [summary, schedule, manual, sources]) {
  sheet.showGridLines = false;
}

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["全部欠款整理表"]];
summary.getRange("A1").format = {
  fill: "#1F4E79",
  font: { bold: true, color: "#FFFFFF", size: 18 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
summary.getRange("A1").format.rowHeightPx = 34;

summary.getRange("A3:H3").values = [[
  "类别",
  "项目",
  "截图/口径",
  "下一还款日",
  "下一期金额",
  "剩余本金",
  "待还/推算总额",
  "备注",
]];
summary.getRange("A4:H8").values = [
  ["账单", "全部待还账单", "截图总额与逐月相加一致", toDate("2026-06-20"), 4530.11, "", "=SUMIFS('逐月还款明细'!$D$2:$D$200,'逐月还款明细'!$A$2:$A$200,B4)", "含未来账单待还金额"],
  ["借款", "借款还款计划", "还款计划共6期", toDate("2026-06-26"), 1063.88, 6182.71, "=SUMIFS('逐月还款明细'!$D$2:$D$200,'逐月还款明细'!$A$2:$A$200,B5)", "截图显示剩余本金6,182.71"],
  ["借款", "18,000借款详情", "第2-6期待还计划", toDate("2026-06-26"), 3232.24, 15000.00, "=SUMIFS('逐月还款明细'!$D$2:$D$200,'逐月还款明细'!$A$2:$A$200,B6)", "截图显示当前15,000.00；此列按可见计划含息求和"],
  ["手写", "手写欠款", "金额 x 余期数并展开到月份", toDate("2026-06-05"), 12000.00, "", "=SUMIFS('逐月还款明细'!$D$2:$D$200,'逐月还款明细'!$A$2:$A$200,B7)", "按截图“余”理解为剩余期数，从2026年6月开始展开"],
  ["合计", "全部合计", "待还/推算总额合计", "", "", "", "=SUM(G4:G7)", "含账单、借款还款计划和手写推算"],
];

const summaryRange = summary.getRange("A3:H8");
summaryRange.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
summary.getRange("A3:H3").format = {
  fill: "#5B9BD5",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
summary.getRange("A4:H8").format = { fill: "#FFFFFF", verticalAlignment: "center" };
summary.getRange("A8:H8").format = {
  fill: "#EAF2F8",
  font: { bold: true, color: "#17365D" },
};
summary.getRange("D4:D8").setNumberFormat("yyyy-mm-dd");
summary.getRange("E4:G8").setNumberFormat('"¥"#,##0.00');
summary.getRange("A:A").format.columnWidthPx = 80;
summary.getRange("B:B").format.columnWidthPx = 150;
summary.getRange("C:C").format.columnWidthPx = 180;
summary.getRange("D:D").format.columnWidthPx = 110;
summary.getRange("E:G").format.columnWidthPx = 115;
summary.getRange("H:H").format.columnWidthPx = 360;
summary.freezePanes.freezeRows(3);

schedule.getRange("A1:F1").values = [["来源/项目", "还款日", "期数/账单", "应还金额", "备注", "附件"]];
schedule.getRangeByIndexes(1, 0, allScheduleRows.length, 6).values = allScheduleRows;
schedule.getRange("A1:F1").format = {
  fill: "#4472C4",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
schedule.getRangeByIndexes(0, 0, allScheduleRows.length + 1, 6).format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2F3",
};
schedule.getRangeByIndexes(1, 1, allScheduleRows.length, 1).setNumberFormat("yyyy-mm-dd");
schedule.getRangeByIndexes(1, 3, allScheduleRows.length, 1).setNumberFormat('"¥"#,##0.00');
schedule.getRange("A:A").format.columnWidthPx = 135;
schedule.getRange("B:B").format.columnWidthPx = 105;
schedule.getRange("C:C").format.columnWidthPx = 120;
schedule.getRange("D:D").format.columnWidthPx = 105;
schedule.getRange("E:E").format.columnWidthPx = 320;
schedule.getRange("F:F").format.columnWidthPx = 260;
schedule.freezePanes.freezeRows(1);
schedule.tables.add(`A1:F${allScheduleRows.length + 1}`, true, "RepaymentSchedule");

manual.getRange("A1:G1").values = [["类别", "日期/日号", "每期金额", "剩余期数", "推算待还总额", "附件", "备注"]];
manual.getRange("A2:G6").values = manualDebts;
manual.getRange("A1:G1").format = {
  fill: "#70AD47",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
manual.getRange("A1:G6").format.borders = { preset: "all", style: "thin", color: "#E2F0D9" };
manual.getRange("C2:C6").setNumberFormat('"¥"#,##0.00');
manual.getRange("E2:E6").setNumberFormat('"¥"#,##0.00');
manual.getRange("A:A").format.columnWidthPx = 100;
manual.getRange("B:B").format.columnWidthPx = 100;
manual.getRange("C:E").format.columnWidthPx = 115;
manual.getRange("F:F").format.columnWidthPx = 130;
manual.getRange("G:G").format.columnWidthPx = 230;
manual.tables.add("A1:G6", true, "ManualDebts");

sources.getRange("A1:B1").values = [["附件", "摘录/说明"]];
sources.getRangeByIndexes(1, 0, sourceRows.length, 2).values = sourceRows;
sources.getRange("A1:B1").format = {
  fill: "#8064A2",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
sources.getRangeByIndexes(0, 0, sourceRows.length + 1, 2).format.borders = {
  preset: "all",
  style: "thin",
  color: "#E4DFEC",
};
sources.getRange("A:A").format.columnWidthPx = 170;
sources.getRange("B:B").format.columnWidthPx = 660;
sources.getRange("B:B").format.wrapText = true;
sources.freezePanes.freezeRows(1);

const monthTotals = new Map();
for (const [, date, , amount] of allScheduleRows) {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  monthTotals.set(month, (monthTotals.get(month) ?? 0) + amount);
}

const chartStartRow = 11;
summary.getRange(`A${chartStartRow}:B${chartStartRow}`).values = [["月份", "计划应还金额"]];
const monthRows = [...monthTotals.entries()].map(([month, total]) => [month, total]);
summary.getRangeByIndexes(chartStartRow, 0, monthRows.length, 2).values = monthRows;
summary.getRange(`A${chartStartRow}:B${chartStartRow + monthRows.length}`).format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2F3",
};
summary.getRange(`A${chartStartRow}:B${chartStartRow}`).format = {
  fill: "#B4C6E7",
  font: { bold: true, color: "#17365D" },
};
summary.getRange(`B${chartStartRow + 1}:B${chartStartRow + monthRows.length}`).setNumberFormat('"¥"#,##0.00');

try {
  const chart = summary.charts.add("bar", summary.getRange(`A${chartStartRow}:B${chartStartRow + monthRows.length}`));
  chart.title = "按月计划应还金额";
  chart.hasLegend = false;
  chart.xAxis = { axisType: "textAxis" };
  chart.yAxis = { numberFormatCode: '"¥"#,##0' };
  chart.setPosition("D11", "H27");
} catch {
  summary.getRange("D11:H11").merge();
  summary.getRange("D11").values = [["按月计划应还金额图表未生成；左侧数据可直接用于制图。"]];
}

await fs.mkdir(outputDir, { recursive: true });

const summaryPreview = await workbook.render({
  sheetName: "汇总",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "preview-summary.png"), new Uint8Array(await summaryPreview.arrayBuffer()));

const schedulePreview = await workbook.render({
  sheetName: "逐月还款明细",
  range: "A1:F20",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "preview-schedule.png"), new Uint8Array(await schedulePreview.arrayBuffer()));

const manualPreview = await workbook.render({
  sheetName: "手写欠款",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "preview-manual.png"), new Uint8Array(await manualPreview.arrayBuffer()));

const sourcesPreview = await workbook.render({
  sheetName: "附件摘录",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "preview-sources.png"), new Uint8Array(await sourcesPreview.arrayBuffer()));

const inspectSummary = await workbook.inspect({
  kind: "table",
  range: "汇总!A3:H8",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 8,
});
console.log(inspectSummary.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(outputPath);
