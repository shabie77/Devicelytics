# 📱 Devicelytics – Secondary Market Device Valuation Engine

A deterministic valuation and decision-support web application engineered to resolve price asymmetry in the secondary consumer electronics market by calculating fair market values based on hardware degradation, cosmetic condition, and lifecycle depreciation models.

🔗 **Live Application:** (https://devicelytics.vercel.app/)

---

## 📌 Problem Context & Objectives

The pre-owned smartphone and laptop secondary markets suffer from severe information asymmetry and arbitrary peer-to-peer pricing. Buyers and sellers lack standardized, objective benchmarks to quantify how physical wear, battery cycle degradation, functional hardware defects, and brand depreciation curves impact an asset's real residual value.

* **Algorithmic Price Standardization:** Replace subjective resale estimates with an objective, multi-factor depreciation engine.
* **Granular Component Auditing:** Assess individual hardware subsystems (battery health, display panels, logic boards, chassis condition) to compute fair deductions.
* **Instant Decision Support:** Provide actionable pricing corridors (Buyer Maximum / Seller Minimum) to facilitate fair transactions.
* **Accessible Web Interface:** Deliver a fast, responsive user interface deployed on modern cloud infrastructure.

---

## 🛠️ Technical Stack & Architecture

* **Framework & Frontend:** Next.js, React, Tailwind CSS
* **Language:** TypeScript / JavaScript
* **Valuation Engine:** Deterministic rule-based pricing models & decay curve algorithms
* **Hosting & Deployment:** Vercel

---

## ⚙️ Analytical Architecture & Valuation Logic

Devicelytics calculates the estimated residual value ($V_{\text{residual}}$) by applying sequential categorical penalties against an asset's baseline market retail anchor:

$$V_{\text{residual}} = V_{\text{base}} \times (1 - D_{\text{age}}) \times \prod (1 - P_{\text{condition}}) - \sum C_{\text{repairs}}$$

### Core Valuation Factors

1. **Lifecycle & Market Age Decay ($D_{\text{age}}$):**
   * Computes base depreciation curves anchored to release cycle benchmarks, operating system support status, and brand-specific resale retention rates.

2. **Component Degradation & Cosmetic Penalties ($P_{\text{condition}}$):**
   * **Battery Health & Charge Cycles:** Scaled deductions applied when battery capacity drops below critical health thresholds (<85%, <80%).
   * **Display Integrity:** Differentiates between minor surface micro-abrasions, deep scratches, dead pixels, and non-OEM display replacements.
   * **Chassis & Body Condition:** Tiered deductions for minor scuffs, frame dents, or structural chassis bending.

3. **Critical Defect Deductions ($\sum C_{\text{repairs}}$):**
   * Direct estimated repair-cost adjustments applied for functional failures (e.g., failed Face ID/Touch ID sensors, damaged camera modules, non-functional ports, speaker distortion).

---

## 🚀 Key Application Features

* **Dynamic Multi-Step Diagnostic Flow:** Guided questionnaire capturing brand, model, storage variant, physical state, and functional integrity.
* **Real-Time Fair Value Range:** Instantly generates a realistic price range reflecting both a competitive buyer purchase target and a reasonable seller listing floor.
* **Deduction Transparency:** Breaks down the specific percentage and monetary impact attributable to individual defects or wear items.
* **Mobile-First Responsive Layout:** Designed for quick evaluations directly on smartphones during in-person peer-to-peer transactions.
