type TabBarInsets = {
  bottom: number;
};

export function getFloatingTabBarMetrics(insets: TabBarInsets) {
  const bottom = 4;
  const paddingBottom = Math.max(insets.bottom, 12);

  return {
    bottom,
    paddingBottom,
    height: 62 + paddingBottom,
  };
}
