/** Synthetic variety-pack Nutrition Facts tables (layout patterns only — no brand copy). */

export const MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS = `
Nutrition Facts
Variety snack bars
Crunchy Wafer  Cocoa Bar  Peanut Mix
Calories
140  150  160
Total Fat
5g  6g  7g
Sodium
120mg  140mg  100mg
Protein
2g  8g  6g
`;

export const MULTI_PRODUCT_FIXTURE_TAB_COLUMNS = `
Nutrition Facts
Amount per serving
Product One\tProduct Two\tProduct Three
Calories\t90\t110\t95
Total Fat\t3g\t4g\t3.5g
Protein\t1g\t2g\t2g
`;

export const MULTI_PRODUCT_FIXTURE_LABEL_THEN_VALUES = `
Nutrition Facts
Mini bars
Alpha Snack    Beta Snack
Calories
80  90
Total Fat
3g  4g
Sodium
95mg  110mg
Total Carbohydrate
12g  14g
Protein
1g  2g
`;

export const MULTI_PRODUCT_FIXTURE_TWO_PRODUCTS = `
Nutrition Facts
Twin pack
Left Item  Right Item
Calories  200  180
Protein  10g  8g
`;

export const MULTI_PRODUCT_FIXTURE_INLINE_ROWS = `
Nutrition Facts
Snack duo
Item A  Item B  Item C
Calories  70  85  90
Total Fat  1g  2g  2.5g
Dietary Fiber  0g  1g  1g
Protein  5g  6g  7g
`;

export const MULTI_PRODUCT_FIXTURE_WITH_PERCENT_NOISE = `
Nutrition Facts
Combo tray
Snack X  Snack Y  Snack Z
Calories
120  130  125
Total Fat
4g  5g  4.5g
3  5  4
Sodium
210mg  220mg  200mg
10  12  9
Protein
3g  4g  3g
`;

/** Single product — parser must not treat as multi-column. */
export const MULTI_PRODUCT_FIXTURE_SINGLE_PANEL = `
Nutrition Facts
Serving size 1 bar (28g)
Calories 150
Total Fat 5g
Protein 3g
`;
