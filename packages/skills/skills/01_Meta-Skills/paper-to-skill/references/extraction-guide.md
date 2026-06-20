# Extraction Guide: Paper-Type-Specific Strategies

This guide defines how to extract research paradigms and methodological techniques from different types of cognitive science and neuroscience papers. Each paper type has distinct sections where extractable knowledge concentrates and distinct priorities for what to capture.

---

## 1. Experimental Papers

**Identification**: Contains original experiments with human (or animal) participants, reports behavioral and/or neural data.

**Primary extraction targets** (in priority order):

### 1.1 Paradigm Design Parameters

- **Where to find**: Methods → Experimental Design / Task / Procedure
- **Extract**:
 - Paradigm name and type (e.g., "modified Sternberg paradigm", "rapid serial visual presentation")
 - Full trial structure with timing diagram:
 - Fixation cross duration (ms)
 - Stimulus onset and duration (ms)
 - Inter-stimulus interval / SOA (ms)
 - Response window onset and duration (ms)
 - Inter-trial interval (ms), including jitter range if applicable
 - Feedback duration (ms), if present
 - Number of conditions and their operational definitions
 - Number of trials per condition and total trial count
 - Number of blocks and trials per block
 - Break/rest interval duration and frequency
 - Counterbalancing scheme:
 - Condition-to-response mapping rotation
 - Stimulus list assignment (Latin square design details)
 - Block order randomization constraints
 - Practice trials: count, whether feedback was provided, exclusion criteria
 - Catch trial percentage and purpose (if applicable)

### 1.2 Data Acquisition Parameters

- **Where to find**: Methods → EEG/fMRI/MEG Recording / Apparatus / Data Acquisition
- **Extract by modality**:

 **EEG**:
 - Amplifier system (manufacturer, model)
 - Electrode count, montage standard (10-20, 10-10, custom)
 - Online reference and ground electrodes
 - Sampling rate (Hz)
 - Online filter settings (high-pass, low-pass, notch)
 - Impedance threshold (kOhm)
 - Additional channels (EOG, EMG) and their placement

 **fMRI**:
 - Scanner field strength (T) and manufacturer
 - Coil type (e.g., 32-channel head coil)
 - Functional scan parameters: TR (ms), TE (ms), flip angle (degrees), voxel size (mm), matrix size, slice count, slice order (ascending/interleaved), multi-band acceleration factor
 - Structural scan parameters: sequence type (MPRAGE, etc.), resolution, TR, TE, TI
 - Number of functional volumes and dummy scans discarded
 - Field map acquisition (if used)

 **Eye-tracking**:
 - System model and manufacturer
 - Sampling rate (Hz)
 - Tracking mode (remote vs. chin rest)
 - Calibration type (5-point, 9-point, 13-point) and acceptance criteria
 - Fixation definition: dispersion threshold, minimum duration
 - Saccade detection: velocity threshold, acceleration threshold

 **Behavioral**:
 - Response device (keyboard, button box, joystick, touchscreen)
 - Response mapping (which keys/buttons for which responses)
 - Timeout/deadline (ms)
 - Presentation software and version

### 1.3 Data Processing Pipeline

- **Where to find**: Methods → Data Analysis / EEG Processing / Preprocessing / fMRI Analysis
- **Extract as an ordered sequence**:
 1. Software and version (e.g., "MNE-Python 1.3.0", "SPM12", "EEGLAB 2022.1")
 2. Each preprocessing step in order, with parameters:
 - Filtering: type (FIR/IIR/Butterworth), cutoffs (Hz), order or transition bandwidth, zero-phase or causal
 - Re-referencing: scheme (average, linked mastoids, Cz, REST)
 - Downsampling: target rate (Hz)
 - Epoching: event-locked to what, time window (ms), baseline window (ms)
 - Artifact detection: method and thresholds (peak-to-peak amplitude uV, flat channel detection, EOG threshold)
 - ICA: algorithm (Infomax, FastICA, AMICA), number of components, component rejection criteria
 - Channel interpolation: method (spherical spline), criteria for bad channel identification
 - Trial rejection rate and participant exclusion threshold
 3. For fMRI: slice timing correction, motion correction, normalization template and parameters, smoothing kernel FWHM (mm)

### 1.4 Analysis Methods

- **Where to find**: Methods → Statistical Analysis / Data Analysis; Results
- **Extract**:
 - Statistical tests with full specification (e.g., "2 x 3 repeated-measures ANOVA with factors Condition (congruent, incongruent) and Region (frontal, central, parietal)")
 - Mixed-effects model specification: fixed effects, random effects structure, optimizer
 - Multiple comparison correction: method (Bonferroni, FDR, cluster-based permutation), parameters (alpha level, cluster-forming threshold, number of permutations)
 - Time window / ROI selection: how chosen (a priori, data-driven, literature-based), exact values
 - Effect size measures reported (Cohen's d, partial eta-squared, Bayes factor)
 - Post-hoc test method
 - Software used for statistics (R package, MATLAB function, Python library)

### 1.5 Stimulus Materials

- **Where to find**: Methods → Materials / Stimuli; sometimes Supplementary Materials
- **Extract**:
 - Material type and total count
 - Per-condition counts
 - Controlled lexical/visual/auditory variables and their matching criteria
 - Norming database used (with citation)
 - Specific ranges or means for controlled variables (e.g., "word frequency: M = 4.2, range 2.1-6.8 per million, SUBTLEX-US")
 - Presentation parameters: visual angle, font/size, luminance, duration, position on screen
 - Filler/catch trial composition

---

## 2. Methods Papers

**Identification**: Introduces, validates, or benchmarks a new analysis technique, software tool, or processing pipeline. May include simulated data or re-analysis of existing datasets.

**Primary extraction targets** (in priority order):

### 2.1 Complete Analysis Pipeline

- **Where to find**: Methods → Algorithm / Pipeline / Procedure; often the entire paper IS the method
- **Extract the full pipeline as a numbered sequence**:
 1. Input data format and requirements
 2. Each processing step with:
 - Algorithm name and mathematical formulation (if provided)
 - Default parameter values and their justification
 - Parameter sensitivity analysis results (which parameters matter most)
 - Computational requirements (runtime, memory)
 3. Output format and interpretation guidelines

### 2.2 Parameter Selection Rationale

- **Where to find**: Methods, Results (parameter sweeps), Discussion
- **Extract**:
 - Recommended default values for each parameter
 - How defaults were determined (simulation, empirical optimization, theoretical derivation)
 - Parameter ranges tested and their effects on performance
 - Guidelines for when to adjust defaults (data characteristics that warrant different settings)
 - Known failure modes and parameter settings that cause them

### 2.3 Validation Methods

- **Where to find**: Results → Validation / Benchmarking / Comparison
- **Extract**:
 - Ground truth definition (simulated data specs, known-result datasets)
 - Performance metrics used (sensitivity, specificity, AUC, RMSE)
 - Comparison against existing methods (which methods, what outcomes)
 - Dataset characteristics where the method excels or fails
 - Recommended validation procedure for new users

### 2.4 Implementation Details

- **Where to find**: Methods, Supplementary Materials, code repositories
- **Extract**:
 - Programming language and dependencies (with versions)
 - Input/output specifications
 - Code repository URL (if provided)
 - Key function names or API entry points
 - Known limitations and edge cases

---

## 3. Computational Modeling Papers

**Identification**: Constructs, fits, or compares formal mathematical/computational models of cognitive processes. May include behavioral or neural data for model fitting.

**Primary extraction targets** (in priority order):

### 3.1 Model Equations and Architecture

- **Where to find**: Methods → Model / Computational Framework; sometimes Theory section
- **Extract**:
 - Model name and class (e.g., "drift-diffusion model", "Bayesian ideal observer", "recurrent neural network")
 - Complete mathematical specification:
 - All equations with variable definitions
 - Relationship between equations (what feeds into what)
 - Boundary/initial conditions
 - Free parameters vs. fixed parameters (list each with role)
 - Model variants tested (if multiple versions compared)

### 3.2 Parameter Constraints and Priors

- **Where to find**: Methods → Model Fitting / Parameter Estimation
- **Extract**:
 - For each free parameter:
 - Name and cognitive interpretation
 - Constraint bounds (lower, upper)
 - Prior distribution (if Bayesian): family, hyperparameters, justification
 - Starting values for optimization (if frequentist)
 - Parameter recovery analysis results (if reported)
 - Identifiability analysis (which parameters can be independently estimated)

### 3.3 Fitting Methods

- **Where to find**: Methods → Model Fitting / Parameter Estimation / Optimization
- **Extract**:
 - Fitting objective: maximum likelihood, least squares, Bayesian posterior
 - Optimization algorithm: name (Nelder-Mead, differential evolution, MCMC), implementation (software, package)
 - For MCMC: number of chains, samples per chain, burn-in, thinning, convergence diagnostic (R-hat threshold)
 - For MLE: number of starting points, convergence criteria
 - Data summary statistics used for fitting (if not fitting raw trial data)
 - Cross-validation procedure (if used)

### 3.4 Model Comparison Strategy

- **Where to find**: Results → Model Comparison / Model Selection
- **Extract**:
 - Comparison metric: AIC, BIC, WAIC, DIC, Bayes factor, cross-validation log-likelihood
 - How group-level comparison was performed (summed individual fits, hierarchical, fixed-effects)
 - Confusion matrix / model recovery analysis (if reported)
 - Winning model and by what margin
 - Qualitative fit assessment: which data patterns does each model capture or miss

### 3.5 Simulation Procedures

- **Where to find**: Methods → Simulation / Predictions; Results
- **Extract**:
 - Simulation parameter settings (which parameter values, how chosen)
 - Number of simulated datasets / participants / trials
 - Random seed handling (if reported)
 - What predictions were generated and how they were compared to data

---

## 4. Review and Theoretical Papers

**Identification**: Synthesizes existing literature, proposes theoretical frameworks, or provides meta-analyses. Does not contain new experimental data (meta-analyses may contain re-analyzed data).

**Primary extraction targets** (in priority order):

### 4.1 Theory-to-Experiment Mapping

- **Where to find**: Throughout; often in dedicated "Predictions" or "Implications" sections
- **Extract**:
 - Theoretical constructs and their proposed operationalizations
 - Predicted dissociations between conditions (what pattern would support vs. refute the theory)
 - Suggested experimental paradigms for testing predictions
 - Recommended dependent variables and expected effect directions

### 4.2 Recommended Paradigm Combinations

- **Where to find**: Discussion, "Future Directions", tables comparing studies
- **Extract**:
 - Which paradigms are recommended for measuring specific constructs
 - Multi-method convergence recommendations (e.g., "combine ERP and eye-tracking for this question")
 - Paradigm comparison tables: which paradigm is best for which research question
 - Known confounds in specific paradigms and suggested controls

### 4.3 Meta-Analytic Parameters (if meta-analysis)

- **Where to find**: Methods → Literature Search / Inclusion Criteria; Results
- **Extract**:
 - Inclusion/exclusion criteria for studies
 - Effect size calculation method
 - Overall effect size with confidence interval
 - Moderator analysis results (which study features influence effect size)
 - Publication bias assessment method and result
 - Recommended sample size based on meta-analytic effect size

### 4.4 Methodological Recommendations

- **Where to find**: Discussion, "Best Practices" sections, "Recommendations", tables comparing approaches
- **Extract**:
 - Specific parameter recommendations with justification and evidence strength (e.g., "Use high-pass filter cutoff of 0.1 Hz, not 0.01 Hz, because..." with citation)
 - Recommended analysis pipelines as step-by-step sequences with default parameter values
 - Decision trees or flowcharts for method selection (e.g., "if data has >20% artifact rate, use ICA; if <10%, use threshold rejection")
 - Meta-analytic effect sizes with confidence intervals, and moderator variables that influence them
 - Sample size recommendations computed from the meta-analytic effect sizes and desired power
 - Common methodological pitfalls identified across studies, with concrete examples of how they manifest and how to avoid them
 - Reporting standards recommended by the review (e.g., "always report filter order and transition bandwidth")
 - Parameter ranges where community consensus exists vs. where it does not

---

## Cross-Cutting Extraction Rules

These rules apply regardless of paper type:

1. **Preserve exact numbers** — Never round. If the paper says "513 ms", write "513 ms", not "~500 ms".
2. **Track the source location** — Note section, page, table, or figure number for each extracted value.
3. **Flag missing information** — If a standard parameter is not reported, explicitly note its absence.
4. **Capture rationale** — When authors explain WHY they chose a parameter value, capture that justification.
5. **Note deviations** — When authors explicitly deviate from convention, capture both what they did and why.
6. **Extract from figures** — Parameters sometimes appear only in figures or figure captions. Read these carefully.
7. **Check supplementary materials** — Methods papers and experimental papers increasingly put critical details in supplements.
