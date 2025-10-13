#!/bin/bash
set -e # コマンドがエラーになったらすぐに終了する

echo "📦 ライブラリの更新プロセスを開始します..."
echo "-------------------------------------"

# 1. デプロイ時の説明文を取得
echo "新しいライブラリバージョンの説明を入力してください (例: '画像のaltテキストを修正'):"
read DEPLOY_DESCRIPTION

if [ -z "$DEPLOY_DESCRIPTION" ]; then
  echo "❌ 説明が入力されなかったため、処理を中断しました。"
  exit 1
fi

# 2. libraryディレクトリに移動し、push & deploy
cd library || { echo "❌ 'library' ディレクトリが見つかりません。"; exit 1; }

echo ""
echo "-> ライブラリのコードをpushしています..."
clasp push

echo ""
echo "-> 新しいバージョンをデプロイしています..."
# clasp deploy の実行結果をキャプチャ
DEPLOY_OUTPUT=$(clasp deploy -d "$DEPLOY_DESCRIPTION")
# 実行結果からバージョン番号を抽出 (例: @5 -> 5)
NEW_VERSION=$(echo "$DEPLOY_OUTPUT" | grep -o '@[0-9]*' | tr -d '@')

if [ -z "$NEW_VERSION" ]; then
    echo "❌ 新しいバージョン番号の取得に失敗しました。"
    echo "実行結果: $DEPLOY_OUTPUT"
    exit 1
fi

echo "✅ 新しいライブラリのバージョンがデプロイされました: $NEW_VERSION"
cd ..

# 3. caller/src/appsscript.json を更新
cd caller || { echo "❌ 'caller' ディレクトリが見つかりません。"; exit 1; }

# jqコマンドの存在チェック
if ! command -v jq &> /dev/null
then
    echo "❌ 'jq' コマンドがインストールされていません。続行するにはインストールしてください (例: 'brew install jq' or 'sudo apt-get install jq')。"
    exit 1
fi

echo ""
echo "-> caller/src/appsscript.json のバージョンを更新しています..."
# jqを使って依存ライブラリのバージョン番号を更新
# (ライブラリがdependenciesの先頭にあることを想定)
jq ".dependencies.libraries[0].version = \"$NEW_VERSION\"" src/appsscript.json > src/appsscript.json.tmp && mv src/appsscript.json.tmp src/appsscript.json

echo "✅ マニフェストファイルのバージョンを $NEW_VERSION に更新しました。"

# 4. 更新されたcallerをpush
echo ""
echo "-> 更新されたcallerのテンプレートをGoogleドキュメントにpushしています..."
clasp push --force

cd ..
echo ""
echo "-------------------------------------"
echo "🎉 ライブラリの更新プロセスが正常に完了しました！"
