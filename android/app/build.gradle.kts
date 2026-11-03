import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/** packServer 的输出目录，作为额外的 assets 目录。 */
val SERVER_ASSETS = "generated/server-assets"

/** 版本号唯一来源：android/version.properties 的 versionName（x.y.z）；versionCode = x*10000 + y*100 + z（ADR-0037） */
val appVersionName: String = providers.gradleProperty("appVersionName").orNull ?: Properties()
    .apply { rootProject.file("version.properties").inputStream().use { load(it) } }
    .getProperty("versionName")
val appVersionCode: Int = appVersionName.split(".").map { it.toInt() }.let { parts ->
    require(parts.size == 3 && parts[0] in 0..214747 && parts[1] in 0..99 && parts[2] in 0..99) { "版本号必须是 x.y.z，y/z 在 0..99，x 不超过 214747" }
    val (major, minor, patch) = parts
    major * 10_000 + minor * 100 + patch
}

/** 发布签名：android/keystore.properties（不进仓库）；没有就不能出发布包 */
val keystoreProps: Properties? = rootProject.file("keystore.properties").takeIf { it.exists() }
    ?.let { file -> Properties().apply { file.inputStream().use { load(it) } } }

android {
    namespace = "com.yingbox.android"
    // 37 = Android 17；compose-bom 2026.08.00 的 AAR 元数据要求依赖方 compileSdk >= 37
    compileSdk = 37

    defaultConfig {
        applicationId = "com.yingbox.android"
        minSdk = 24
        targetSdk = 37
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 没有 keystore.properties 时不签名，gradle 任务 assertReleaseSigning 会拦住发布
            if (keystoreProps != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    // 发布时按 ABI 拆成各自的包（-PsplitAbi）；-PreleaseAbis=arm64-v8a 只出指定的 ABI，不传则 arm64-v8a 与 x86_64（模拟器）都出
    splits {
        abi {
            isEnable = project.hasProperty("splitAbi")
            reset()
            include(*(providers.gradleProperty("releaseAbis").orNull?.split(",")?.toTypedArray() ?: arrayOf("arm64-v8a", "x86_64")))
            isUniversalApk = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // libnode.so 是可执行文件，要解压到 nativeLibraryDir 才能执行（ADR-0034）
        jniLibs { useLegacyPackaging = true }
    }

    sourceSets {
        getByName("main").assets.srcDir("build/$SERVER_ASSETS")
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

// 服务端由 pnpm build:android 整理到 out/packages/yingbox-server，这里压成 assets/server.zip
val packServer = tasks.register<Zip>("packServer") {
    val source = rootProject.file("../out/packages/yingbox-server")
    doFirst {
        check(source.resolve("out/server/server.js").exists()) {
            "没有整理好的服务端：先在仓库根目录运行 pnpm build:android"
        }
    }
    from(source) {
        // 许可证随服务端一起进 APK（ADR-0028 后果：第三方声明）
        include("out/**", "node_modules/**", "package.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/**")
    }
    archiveFileName.set("server.zip")
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    destinationDirectory.set(layout.buildDirectory.dir(SERVER_ASSETS))
}

tasks.named("preBuild") { dependsOn(packServer) }

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.tv.material)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)
    implementation(libs.haze)
}

// 发布包必须有发布签名：没有 keystore.properties 时提前报错，免得出一个调试签名的「发布包」
tasks.register("assertReleaseSigning") {
    doFirst { check(keystoreProps != null) { "没有 android/keystore.properties：发布签名密钥见 docs/adr/0037" } }
}
tasks.matching { it.name == "assembleRelease" || it.name == "packageRelease" }.configureEach { dependsOn("assertReleaseSigning") }
