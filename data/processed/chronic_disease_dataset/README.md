# chronic_disease_dataset 预处理产物

- 生成时间: 2026-03-11T16:27:38.077Z
- TriageRequest 样本: 5461
- Evaluation 样本: 5461
- 切分: train=3933, dev=778, test=750

## 文件说明

- `triage_requests.ndjson`: 可直接用于 `/orchestrate_triage` 批量回放
- `triage_requests.train.ndjson` / `dev` / `test`: 按患者稳定切分
- `evaluation_cases.ndjson`: 包含期望诊断/风险提示，用于真实性与复杂性评测
- `quality_report.json`: 行数、缺失率、异常值等预处理质量报告

## 运行命令

```bash
npm run dataset:preprocess:chronic
```
