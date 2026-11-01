plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.yingbox.android"
    // 36 = Android 16；compileSdk / targetSdk 随官方稳定版上调
    compileSdk = 36

    defaultConfig {
        applicationId = "com.yingbox.android"
        // nodejs-mobile 24.x 的最低 SDK 是 24（Android 7.0），见 ADR-0028
        minSdk = 24
        targetSdk = 36
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

    buildFeatures {
        compose = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.tv.material)
    implementation(libs.androidx.media3.exoplayer)
}
