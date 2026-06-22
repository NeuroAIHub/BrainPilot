# Inter-group Difference Testing Rules (Convention)

The statistical test selection for this skill follows these rules:

- **Two groups (2 groups)**:
  - Parametric test: **t-test** (default: Welch t-test, more robust when variances are unequal)
  - Non-parametric test: **Mann-Whitney U test**
  - Directly compare differences between two groups

- **Three or more groups (>=3 groups)**:
  - Parametric test: **One-way ANOVA**
  - Non-parametric test: **Kruskal-Wallis test**
  - First perform overall test to see if there are differences between groups; if overall is significant (p <= alpha), then perform **pairwise comparisons**

- **Pairwise comparisons**:
  - If overall is parametric: default use **Welch t-test** for pairwise
  - If overall is non-parametric: default use **Mann-Whitney U** for pairwise
  - Multiple comparison correction: default **Holm-Bonferroni** (output p_holm)
