module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // expo-router/babel is included in babel-preset-expo on SDK 50+.
      // Reanimated must stay LAST.
      'react-native-reanimated/plugin',
    ],
  };
};
