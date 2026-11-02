plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/** packServer 的输出目录，作为额外的 assets 目录。 */
val SERVER_ASSETS = "generated/server-assets"

android {
    namespace = "com.yingbox.android"
    // 37 = Android 17；compose-bom 2026.08.00 的 AAR 元数据要求依赖方 compileSdk >= 37
    compileSdk = 37

    defaultConfig {
        applicationId = "com.yingbox.android"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "0.0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // libnode.so 是可执行文件，要解压到 nativeLibraryDir 才能执行（ADR-0029）
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
}
