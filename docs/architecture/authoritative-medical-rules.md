# Authoritative Medical Rules and Four-Layer Governance (Updated: 2026-03-01)

This project maintains an executable medical rule catalog at:

- `src/backend/src/domain/rules/AuthoritativeMedicalRuleCatalog.ts`

## Four-Layer Rule Architecture

1. Basic Safety Layer (`BASIC_SAFETY` / 基础安全层)
- Emergency symptom pattern detection
- Stroke warning sign detection
- Severe hypoglycemia detection
- Immediate offline escalation boundary

2. Flow Control Layer (`FLOW_CONTROL` / 流程控制层)
- Consent and minimum-information gating
- Typed vital-sign consistency validation
- Severe hypertension "same-day specialist review" pathway

3. Intelligent Collaboration Layer (`INTELLIGENT_COLLABORATION` / 智能协同层)
- Complexity routing and collaboration mode switching
- Confidence calibration and abstain fallback
- Baseline-guard mediation between rule and model opinions

4. Operations Layer (`OPERATIONS` / 运维层)
- Release-block risk triggers (metrics, gate evidence)
- Stop-loss and rollback guardrails
- Knowledge-version governance controls

## Authoritative Sources and Rule Mapping

1. NICE NG136 (updated on 2026-02-03)
- URL: https://www.nice.org.uk/guidance/ng136/chapter/Recommendations
- Applied:
  - `SBP >= 180` or `DBP >= 120`: severe hypertension threshold
  - If severe hypertension coexists with life-threatening symptoms/signs:
    emergency escalation (`L3`)
  - If severe hypertension without immediate life-threatening symptoms:
    same-day specialist review (`L2`)

2. ACC/AHA 2025 high blood pressure guideline release
- URL: https://www.acc.org/About-ACC/Press-Releases/2025/09/03/17/42/New-High-Blood-Pressure-Guideline
- Applied:
  - Stage-1 threshold (`>=130/80`) for higher sensitivity risk stratification
  - Stage-1 + high-risk comorbidity upgraded to urgent path (`L2`)

3. American Diabetes Association diagnosis criteria
- URL: https://diabetes.org/about-diabetes/diagnosis
- Applied:
  - Random glucose `>=200 mg/dL` + classic hyperglycemia symptoms:
    urgent pathway (`L2`)

4. CDC stroke warning signs (page updated on 2025-10-17)
- URL: https://www.cdc.gov/stroke/signs-symptoms/index.html
- Applied:
  - Sudden neurological warning sign patterns trigger emergency escalation (`L3`)

5. Endocrine Society hypoglycemia guideline (2023)
- URL: https://www.endocrine.org/clinical-practice-guidelines/high-risk-for-hypoglycemia
- Applied:
  - Level-2 hypoglycemia (`<54 mg/dL`) treated as high-severity safety signal

## Notes for Future Knowledge-DB Co-Engine

- The rule catalog is intentionally deterministic and auditable.
- Each rule has a stable ID and layer, making it suitable for future
  retrieval-augmented joins with a medical knowledge database.
- The knowledge database can provide richer context/citations, while this
  ruleset remains the hard boundary/safety governor.
