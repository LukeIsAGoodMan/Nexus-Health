// Nexus Health V1.5 — Food Quick-Search Database
// Curated list of common professional foods with standard calorie values.

export interface FoodItem {
  id: string
  name: string        // EN name
  nameCn: string      // CN name
  kcal: number        // per standard serving
  serving: string     // serving description
}

export const FOOD_DB: FoodItem[] = [
  { id: 'chicken_breast',   name: 'Chicken Breast',       nameCn: '鸡胸肉',       kcal: 165, serving: '100g' },
  { id: 'salmon_fillet',    name: 'Salmon Fillet',        nameCn: '三文鱼',       kcal: 208, serving: '100g' },
  { id: 'brown_rice',       name: 'Brown Rice',           nameCn: '糙米饭',       kcal: 215, serving: '1 cup cooked' },
  { id: 'white_rice',       name: 'White Rice',           nameCn: '白米饭',       kcal: 240, serving: '1 cup cooked' },
  { id: 'egg',              name: 'Egg (whole)',          nameCn: '鸡蛋',         kcal: 78,  serving: '1 large' },
  { id: 'avocado_toast',    name: 'Avocado Toast',        nameCn: '牛油果吐司',   kcal: 290, serving: '1 slice' },
  { id: 'latte',            name: 'Latte',                nameCn: '拿铁咖啡',     kcal: 190, serving: '16oz / grande' },
  { id: 'americano',        name: 'Americano',            nameCn: '美式咖啡',     kcal: 15,  serving: '16oz' },
  { id: 'oatmeal',          name: 'Oatmeal',              nameCn: '燕麦粥',       kcal: 150, serving: '1 cup cooked' },
  { id: 'banana',           name: 'Banana',               nameCn: '香蕉',         kcal: 105, serving: '1 medium' },
  { id: 'apple',            name: 'Apple',                nameCn: '苹果',         kcal: 95,  serving: '1 medium' },
  { id: 'greek_yogurt',     name: 'Greek Yogurt',         nameCn: '希腊酸奶',     kcal: 130, serving: '170g' },
  { id: 'protein_shake',    name: 'Protein Shake',        nameCn: '蛋白粉奶昔',   kcal: 160, serving: '1 scoop + water' },
  { id: 'salad_bowl',       name: 'Salad Bowl',           nameCn: '沙拉碗',       kcal: 350, serving: '1 bowl' },
  { id: 'steak',            name: 'Beef Steak',           nameCn: '牛排',         kcal: 271, serving: '100g' },
  { id: 'pasta',            name: 'Pasta (cooked)',       nameCn: '意面',         kcal: 220, serving: '1 cup cooked' },
  { id: 'bread_slice',      name: 'Bread',                nameCn: '面包片',       kcal: 79,  serving: '1 slice' },
  { id: 'sweet_potato',     name: 'Sweet Potato',         nameCn: '红薯',         kcal: 103, serving: '1 medium' },
  { id: 'tofu',             name: 'Tofu',                 nameCn: '豆腐',         kcal: 144, serving: '1/2 block' },
  { id: 'milk',             name: 'Whole Milk',           nameCn: '全脂牛奶',     kcal: 149, serving: '1 cup / 240ml' },
  { id: 'almonds',          name: 'Almonds',              nameCn: '杏仁',         kcal: 164, serving: '28g / handful' },
  { id: 'fried_rice',       name: 'Fried Rice',           nameCn: '炒饭',         kcal: 390, serving: '1 plate' },
  { id: 'dumplings',        name: 'Dumplings',            nameCn: '饺子',         kcal: 280, serving: '8 pcs' },
  { id: 'bubble_tea',       name: 'Bubble Tea',           nameCn: '奶茶',         kcal: 350, serving: '1 cup / 500ml' },
  { id: 'ramen',            name: 'Ramen',                nameCn: '拉面',         kcal: 450, serving: '1 bowl' },
]

export function searchFood(query: string, locale: 'en' | 'cn'): FoodItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return FOOD_DB
  return FOOD_DB.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.nameCn.includes(q) ||
    f.id.includes(q)
  ).slice(0, 8)  // limit results for quick display
}
