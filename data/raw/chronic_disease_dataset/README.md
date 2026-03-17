# 慢性病智能诊断测试数据集

## 数据集概述

本数据集是根据《慢性病智能诊断测试数据集构建方案》构建的标准化医疗数据集，旨在为医疗智能体提供慢性病诊断能力的测试基准。

### 核心特征

- **患者总数**: 2,200例
- **就诊记录**: 5,461次
- **实验室检查**: 5,461项
- **诊断记录**: 5,338条
- **用药记录**: 13,512条
- **随访记录**: 7,950次

### 覆盖病种

1. **高血压** (原发性高血压分级、继发性高血压鉴别、高血压急症识别)
2. **糖尿病** (1型糖尿病、2型糖尿病、妊娠糖尿病、特殊类型)
3. **心脏病** (冠心病、心律失常、心力衰竭、心脏瓣膜病)

### 病种分布

| 病种类型 | 病例数 | 占比 |
|:---|:---|:---|
| 单纯高血压 | 751例 | 34.1% |
| 单纯糖尿病 | 527例 | 24.0% |
| 单纯心脏病 | 310例 | 14.1% |
| 高血压+糖尿病 | 244例 | 11.1% |
| 高血压+糖尿病+心脏病 | 121例 | 5.5% |
| 高血压+心脏病 | 117例 | 5.3% |
| 糖尿病+心脏病 | 76例 | 3.5% |
| 其他 | 54例 | 2.5% |

## 数据结构

### 1. 患者基本信息 (patient.csv / patients.json)

| 字段 | 说明 | 数据类型 |
|:---|:---|:---|
| patient_id | 患者伪标识符 | 字符串 |
| birth_year_month | 出生年月 | YYYY-MM |
| gender | 性别 | 1=男, 2=女, 9=未说明 |
| ethnicity | 民族编码 | GB/T 3304 |
| occupation | 职业编码 | GB/T 6565 |
| education | 教育程度 | 1-5 |
| insurance_type | 医保类型 | 1-6 |
| height_cm | 身高(cm) | 数值 |
| weight_kg | 体重(kg) | 数值 |
| BMI | 体重指数 | 数值 |
| waist_cm | 腰围(cm) | 数值 |
| smoking_status | 吸烟状态 | 1=从不, 2=已戒, 3=吸烟 |
| alcohol_status | 饮酒状态 | 1=从不, 2=已戒, 3=饮酒 |
| family_history | 家族史 | 分号分隔 |
| has_hypertension | 是否高血压 | 布尔值 |
| has_diabetes | 是否糖尿病 | 布尔值 |
| has_heart_disease | 是否心脏病 | 布尔值 |

### 2. 就诊记录 (visit.csv / visits.json)

| 字段 | 说明 | 数据类型 |
|:---|:---|:---|
| visit_id | 就诊标识符 | 字符串 |
| patient_id | 患者标识符 | 字符串 |
| visit_datetime | 就诊日期时间 | ISO8601 |
| visit_type | 就诊类型 | 1-6 |
| department | 就诊科室 | 字符串 |
| chief_complaint | 主诉 | 字符串 |
| systolic_bp | 收缩压(mmHg) | 数值 |
| diastolic_bp | 舒张压(mmHg) | 数值 |
| heart_rate | 心率(次/分) | 数值 |
| respiratory_rate | 呼吸频率(次/分) | 数值 |
| temperature | 体温(°C) | 数值 |

### 3. 实验室检查 (lab_result.csv / lab_results.json)

| 字段 | 说明 | 参考范围 |
|:---|:---|:---|
| lab_id | 检查标识符 | 字符串 |
| patient_id | 患者标识符 | 字符串 |
| visit_id | 就诊标识符 | 字符串 |
| test_date | 检查日期 | YYYY-MM-DD |
| fasting_glucose_mmol_L | 空腹血糖(mmol/L) | 3.9-6.0 |
| postprandial_glucose_mmol_L | 餐后血糖(mmol/L) | <7.8 |
| hba1c_percent | 糖化血红蛋白(%) | <6.0% |
| total_cholesterol_mmol_L | 总胆固醇(mmol/L) | <5.2 |
| ldl_cholesterol_mmol_L | LDL-C(mmol/L) | <3.4 |
| hdl_cholesterol_mmol_L | HDL-C(mmol/L) | >1.0 |
| triglycerides_mmol_L | 甘油三酯(mmol/L) | <1.7 |
| serum_creatinine_umol_L | 血肌酐(μmol/L) | 男59-104, 女45-84 |
| egfr_ml_min_1_73m2 | eGFR | ≥90 |
| uacr_mg_g | 尿白蛋白/肌酐比(mg/g) | <30 |
| potassium_mmol_L | 血钾(mmol/L) | 3.5-5.3 |
| sodium_mmol_L | 血钠(mmol/L) | 137-147 |

### 4. 诊断记录 (diagnosis.csv / diagnoses.json)

| 字段 | 说明 | 数据类型 |
|:---|:---|:---|
| diagnosis_id | 诊断标识符 | 字符串 |
| patient_id | 患者标识符 | 字符串 |
| visit_id | 就诊标识符 | 字符串 |
| diagnosis_date | 诊断日期 | YYYY-MM-DD |
| primary_icd10 | 主要诊断ICD-10 | 字符串 |
| primary_name | 主要诊断名称 | 字符串 |
| secondary_icd10s | 次要诊断ICD-10 | 分号分隔 |
| secondary_names | 次要诊断名称 | 分号分隔 |

### 5. 用药记录 (medication.csv / medications.json)

| 字段 | 说明 | 数据类型 |
|:---|:---|:---|
| medication_id | 用药标识符 | 字符串 |
| patient_id | 患者标识符 | 字符串 |
| visit_id | 就诊标识符 | 字符串 |
| drug_name | 药品名称 | 字符串 |
| drug_category | 药物类别 | 字符串 |
| dosage | 剂量 | 数值/字符串 |
| unit | 单位 | 字符串 |
| frequency | 频次 | 字符串 |
| route | 给药途径 | 字符串 |
| start_date | 开始日期 | YYYY-MM-DD |
| indication | 适应症 | 字符串 |
| adherence | 依从性 | 1=依从, 2=间断, 3=不服 |

### 6. 随访记录 (followup.csv / followups.json)

| 字段 | 说明 | 数据类型 |
|:---|:---|:---|
| followup_id | 随访标识符 | 字符串 |
| patient_id | 患者标识符 | 字符串 |
| visit_id | 就诊标识符 | 字符串 |
| followup_date | 随访日期 | YYYY-MM-DD |
| followup_mode | 随访方式 | 1-5 |
| symptom_description | 症状描述 | 字符串 |
| symptom_severity | 症状严重程度 | 字符串 |
| followup_systolic | 随访收缩压 | 数值 |
| followup_diastolic | 随访舒张压 | 数值 |
| bp_control_status | 血压控制状态 | 达标/基本达标/未达标 |
| followup_heart_rate | 随访心率 | 数值 |
| followup_weight | 随访体重 | 数值 |
| medication_adherence | 用药依从性 | 1-3 |
| lifestyle_counseling | 生活方式指导 | 分号分隔 |
| next_followup_date | 下次随访日期 | YYYY-MM-DD |
| followup_classification | 随访分类 | 1-4 |

## 数据格式

数据集提供两种格式：

1. **JSON格式** (`json/`目录): 完整的嵌套结构，适合程序化处理
2. **CSV格式** (`csv/`目录): 扁平化表格，适合数据分析和Excel查看

## 使用指南

### 智能体测试场景

#### 1. 单病种诊断测试

评估智能体对单一慢性病的诊断准确性：

```python
# 高血压分级诊断测试
hypertension_cases = [p for p in patients if p["disease_profile"]["has_hypertension"]]
# 评估智能体对血压分级(1级/2级/3级)的准确性

# 糖尿病诊断标准测试
diabetes_cases = [p for p in patients if p["disease_profile"]["has_diabetes"]]
# 评估智能体对诊断标准(FPG/PPG/HbA1c)的应用
```

#### 2. 多病共存复杂场景

```python
# 高血压+糖尿病共存病例
htn_dm_cases = [p for p in patients if p["disease_profile"]["disease_type"] == "htn_dm"]
# 评估智能体对多病共存时的综合诊断和治疗决策
```

#### 3. 诊疗流程决策测试

```python
# 基于指南依从性评估
# 检查智能体是否遵循《中国高血压防治指南(2024)》推荐
# 检查智能体是否遵循《中国2型糖尿病防治指南》推荐
```

#### 4. 随访策略执行测试

```python
# 随访时机决策评估
followup_cases = [f for f in followups]
# 评估智能体对随访频率、内容完整性、决策调整的合理性
```

## 数据质量

### 完整性

- 患者关键字段完整率: 100%
- 就诊关键字段完整率: 100%
- 实验室检查关键字段完整率: 100%

### 逻辑一致性

- 诊断与检查结果逻辑匹配
- 用药与诊断适应症审核
- 时间序列数据合理性检查

### 生理参数范围

- 收缩压: 112-220 mmHg
- 舒张压: 72-130 mmHg
- 空腹血糖: 4.0-16.0 mmol/L
- HbA1c: 4.5-12.0%
- 血肌酐: 62.9-142.8 μmol/L
- eGFR: 41.3-116.2 ml/min/1.73m²

## 人口学特征

- **性别分布**: 男性 55.1%, 女性 44.9%
- **年龄范围**: 35-85岁
- **平均年龄**: 62.5岁

## 编码标准

- **ICD-10**: 国际疾病分类第10版
- **民族编码**: GB/T 3304
- **职业编码**: GB/T 6565

## 参考指南

1. 《中国高血压防治指南(2024年修订版)》
2. 《中国2型糖尿病防治指南》
3. 《中国心力衰竭诊断和治疗指南》
4. 《急性ST段抬高型心肌梗死诊断和治疗指南》
5. WS 372.2-2012《疾病管理基本数据集 第2部分：高血压患者健康管理》
6. WS 372.5-2012《2型糖尿病患者健康管理》

## 版本信息

- **数据集版本**: v1.0
- **发布日期**: 2026-03-11
- **数据生成日期**: 2026-03-11

## 注意事项

1. 本数据集为合成数据，仅供算法研发和测试使用
2. 患者标识符为伪标识符，不可逆加密生成
3. 数据已脱敏处理，不含真实患者隐私信息
4. 使用本数据集进行研究需遵守相关伦理规范

## 引用

如使用本数据集发表研究成果，请引用：

```
慢性病智能诊断测试数据集 v1.0, 2026
基于《慢性病智能诊断测试数据集构建方案》生成
```
